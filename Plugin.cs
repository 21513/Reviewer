using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Linq;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.Logging;

namespace Reviewer;

/// <summary>
/// The main plugin class.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>
{
    private readonly ILogger<Plugin> _logger;
    private static ReviewCache? _reviewCache;

    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">Instance of the <see cref="IApplicationPaths"/> interface.</param>
    /// <param name="xmlSerializer">Instance of the <see cref="IXmlSerializer"/> interface.</param>
    /// <param name="logger">Instance of the <see cref="ILogger{Plugin}"/> interface.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer, ILogger<Plugin> logger)
        : base(applicationPaths, xmlSerializer)
    {
        _logger = logger;
        
        // Initialize cache
        _reviewCache = new ReviewCache(DataFolderPath);
        
        _logger.LogInformation("🎬 Reviewer Plugin: Starting initialization...");
        
        // Create web injection script
        _ = Task.Run(async () => await InitializePluginAsync(applicationPaths));
    }

    private async Task InitializePluginAsync(IApplicationPaths applicationPaths)
    {
        try
        {
            await CreateWebScriptAsync(applicationPaths);
            
            await InjectIntoIndexHtmlAsync(applicationPaths);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Reviewer] Failed to inject");
        }
    }
    
    private async Task CreateWebScriptAsync(IApplicationPaths applicationPaths)
    {
        try
        {
            var webPath = Path.Combine(applicationPaths.WebPath, "Reviewer-inject.js");
            var assembly = Assembly.GetExecutingAssembly();
            
            var htmlInject = await LoadEmbeddedResourceAsync(assembly, "Reviewer.main.html");
            var jsInject = await LoadEmbeddedResourceAsync(assembly, "Reviewer.main.js");
            var cssInject = await LoadEmbeddedResourceAsync(assembly, "Reviewer.main.css");
            
            var processedHtml = htmlInject.Replace("{{CSS_STYLES}}", cssInject);
            var scriptContent = jsInject.Replace("{{HTML_TEMPLATE}}", EscapeJs(processedHtml));
            
            await File.WriteAllTextAsync(webPath, scriptContent);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Reviewer] Failed to create web injection script");
        }
    }
    
    private async Task<string> LoadEmbeddedResourceAsync(Assembly assembly, string resourceName)
    {
        using (var stream = assembly.GetManifestResourceStream(resourceName))
        {
            if (stream != null)
            {
                using (var reader = new StreamReader(stream))
                {
                    return await reader.ReadToEndAsync();
                }
            }
            else
            {
                _logger.LogWarning("[Reviewer] Could not find embedded resource: {ResourceName}", resourceName);
                return "";
            }
        }
    }
    
    /// <summary>
    /// WARNING: This method modifies Jellyfin's index.html file directly.
    /// This can cause issues with:
    /// - Jellyfin updates (file may be overwritten)
    /// - Troubleshooting (unexpected modifications)
    /// - System stability
    /// Consider using Jellyfin's official plugin web hosting mechanism instead.
    /// </summary>
    private async Task InjectIntoIndexHtmlAsync(IApplicationPaths applicationPaths)
    {
        try
        {
            var indexPath = Path.Combine(applicationPaths.WebPath, "index.html");
            if (File.Exists(indexPath))
            {
                var indexContent = await File.ReadAllTextAsync(indexPath);
                var scriptTag = "<script src=\"/web/Reviewer-inject.js\"></script>";
                
                if (!indexContent.Contains("Reviewer-inject.js"))
                {
                    if (indexContent.Contains("</head>"))
                    {
                        indexContent = indexContent.Replace("</head>", scriptTag + "\n</head>");
                        await File.WriteAllTextAsync(indexPath, indexContent);
                    }
                }
                else
                {
                    _logger.LogInformation("[Reviewer] Script already injected");
                }
            }
            else
            {
                _logger.LogWarning("[Reviewer] index.html not found at: {Path}", indexPath);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Reviewer] Failed to inject into index.html");
        }
    }
    
    private string EscapeJs(string input)
    {
        if (string.IsNullOrEmpty(input)) return "";
        return input.Replace("\\", "\\\\").Replace("`", "\\`").Replace("$", "\\$");
    }
    
    private static readonly Regex ImdbIdValidation = new Regex(@"^tt\d{7,8}$", RegexOptions.Compiled);
    
    public static async Task<string?> ScrapeImdbReview(string imdbId)
    {
        try
        {
            if (string.IsNullOrEmpty(imdbId) || !ImdbIdValidation.IsMatch(imdbId))
            {
                System.Diagnostics.Debug.WriteLine($"[Reviewer] Invalid IMDb ID format: {imdbId}");
                return null;
            }
            
            if (_reviewCache != null)
            {
                var cached = _reviewCache.Get(imdbId);
                if (cached != null)
                {
                    return cached;
                }
            }
            
            using var httpClient = new HttpClient();
            httpClient.Timeout = TimeSpan.FromSeconds(8);
            httpClient.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
            
            var url = $"https://www.imdb.com/title/{imdbId}/reviews";
            
            var response = await httpClient.GetAsync(url);
            
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }
            
            var html = await response.Content.ReadAsStringAsync();
            var reviewsArrayMatch = Regex.Match(html, @"""reviews""\s*:\s*\[(.*?)\]", RegexOptions.Singleline);
            
            if (reviewsArrayMatch.Success)
            {
                var reviewsJson = reviewsArrayMatch.Groups[1].Value;
                
                // Extract up to 7 reviews
                var reviewMatches = Regex.Matches(reviewsJson, @"""reviewText""\s*:\s*""([^""]{50,}[^""]*)""", RegexOptions.Singleline);
                var authorMatches = Regex.Matches(reviewsJson, @"""author""\s*:\s*\{[^\}]*""username""\s*:\s*\{[^\}]*""text""\s*:\s*""([^""]+)""", RegexOptions.Singleline);
                var ratingMatches = Regex.Matches(reviewsJson, @"""authorRating""\s*:\s*(\d+)", RegexOptions.Singleline);
                
                var reviewsList = new List<string>();
                var reviewCount = Math.Min(7, reviewMatches.Count);
                
                for (int i = 0; i < reviewCount; i++)
                {
                    var reviewText = reviewMatches[i].Groups[1].Value;
                    var author = i < authorMatches.Count ? authorMatches[i].Groups[1].Value : "Anonymous";
                    var rating = i < ratingMatches.Count ? ratingMatches[i].Groups[1].Value : "";

                    reviewText = System.Text.RegularExpressions.Regex.Replace(reviewText, @"\\u([0-9a-fA-F]{4})", 
                        m => ((char)int.Parse(m.Groups[1].Value, System.Globalization.NumberStyles.HexNumber)).ToString());
                    author = System.Text.RegularExpressions.Regex.Replace(author, @"\\u([0-9a-fA-F]{4})", 
                        m => ((char)int.Parse(m.Groups[1].Value, System.Globalization.NumberStyles.HexNumber)).ToString());

                    reviewText = reviewText.Replace("\\n", "\n")
                                           .Replace("\\r", "")
                                           .Replace("\\t", " ")
                                           .Replace("\\\"", "\"")
                                           .Replace("\\'", "'")
                                           .Replace("\\\\", "\\");
                    
                    author = author.Replace("\\n", " ")
                                   .Replace("\\r", "")
                                   .Replace("\\\"", "\"")
                                   .Replace("\\'", "'")
                                   .Replace("\\\\", "\\");

                    reviewText = System.Net.WebUtility.HtmlDecode(reviewText).Trim();
                    author = System.Net.WebUtility.HtmlDecode(author).Trim();
                    
                    reviewsList.Add($"{author}|||{rating}|||{reviewText}");
                }
                
                if (reviewsList.Count > 0)
                {
                    var result = string.Join("@@@", reviewsList);
                    
                    if (_reviewCache != null)
                    {
                        await _reviewCache.Set(imdbId, result);
                    }
                    
                    return result;
                }
            }

            
            var matches = Regex.Matches(html, @"<div[^>]*reviewText[^>]*>(.*?)</div>", RegexOptions.Singleline | RegexOptions.IgnoreCase);
            
            if (matches.Count == 0)
            {
                matches = Regex.Matches(html, @"<div[^>]*class=""[^""]*content[^""]*""[^>]*>(.*?)</div>", RegexOptions.Singleline | RegexOptions.IgnoreCase);
            }
            
            if (matches.Count > 0)
            {
                var bestMatch = matches.Cast<Match>()
                    .OrderByDescending(m => m.Groups[1].Value.Length)
                    .FirstOrDefault();
                
                if (bestMatch != null)
                {
                    var reviewHtml = bestMatch.Groups[1].Value;
                    
                    var reviewText = Regex.Replace(reviewHtml, "<.*?>", string.Empty);
                    reviewText = System.Net.WebUtility.HtmlDecode(reviewText).Trim();

                    if (reviewText.Length < 50)
                    {
                        return null;
                    }
                    
                    var authorMatch = Regex.Match(html, @"<span class=""display-name-link""><a[^>]*>(.*?)</a>");
                    var author = authorMatch.Success ? System.Net.WebUtility.HtmlDecode(authorMatch.Groups[1].Value) : "Anonymous";
                    
                    var result = $"{author}||||||{reviewText}";
                    
                    if (_reviewCache != null)
                    {
                        await _reviewCache.Set(imdbId, result);
                        System.Diagnostics.Debug.WriteLine($"[Reviewer] Cached review for: {imdbId}");
                    }
                    
                    return result;
                }
            }

            var divMatches = Regex.Matches(html, @"<div[^>]*class=""[^""]*review[^""]*""[^>]*>", RegexOptions.IgnoreCase);
            
            return null;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Reviewer] Exception: {ex.Message}");
            System.Diagnostics.Debug.WriteLine($"[Reviewer] Stack trace: {ex.StackTrace}");
            return null;
        }
    }

    /// <inheritdoc />
    public override string Name => "Reviewer";

    /// <inheritdoc />
    public override string Description => "Adds a custom section to movie detail pages";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("909531ee-1a34-4730-800e-44316f07cbff");
}