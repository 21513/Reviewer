using System;
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
            // Create the injection script
            await CreateWebScriptAsync(applicationPaths);
            
            // Try to inject into index.html
            await InjectIntoIndexHtmlAsync(applicationPaths);
            
            _logger.LogInformation("✅ Reviewer Plugin: Initialization complete!");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Reviewer Plugin: Initialization failed");
        }
    }
    
    private async Task CreateWebScriptAsync(IApplicationPaths applicationPaths)
    {
        try
        {
            var webPath = Path.Combine(applicationPaths.WebPath, "Reviewer-inject.js");
            var assembly = Assembly.GetExecutingAssembly();
            
            // Load templates from embedded resources
            var htmlInject = await LoadEmbeddedResourceAsync(assembly, "Reviewer.main.html");
            var jsInject = await LoadEmbeddedResourceAsync(assembly, "Reviewer.main.js");
            var cssInject = await LoadEmbeddedResourceAsync(assembly, "Reviewer.main.css");
            
            // Replace placeholders in templates
            var processedHtml = htmlInject.Replace("{{CSS_STYLES}}", cssInject);
            var scriptContent = jsInject.Replace("{{HTML_TEMPLATE}}", EscapeJs(processedHtml));
            
            await File.WriteAllTextAsync(webPath, scriptContent);
            _logger.LogInformation("📄 Created web injection script at: {Path}", webPath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Failed to create web script");
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
                _logger.LogWarning("⚠️ Could not find embedded resource: {ResourceName}", resourceName);
                return "";
            }
        }
    }
    
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
                        _logger.LogInformation("📝 Injected script into index.html");
                    }
                }
                else
                {
                    _logger.LogInformation("ℹ️ Script already injected in index.html");
                }
            }
            else
            {
                _logger.LogWarning("⚠️ index.html not found at: {Path}", indexPath);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Failed to inject into index.html");
        }
    }
    
    private string EscapeJs(string input)
    {
        if (string.IsNullOrEmpty(input)) return "";
        return input.Replace("\\", "\\\\").Replace("`", "\\`").Replace("$", "\\$");
    }
    
    public static async Task<string?> ScrapeImdbReview(string imdbId)
    {
        try
        {
            System.Diagnostics.Debug.WriteLine($"🔍 [Reviewer] Scraping IMDb review for: {imdbId}");
            
            // Check cache first
            if (_reviewCache != null)
            {
                var cached = _reviewCache.Get(imdbId);
                if (cached != null)
                {
                    System.Diagnostics.Debug.WriteLine($"✅ [Reviewer] Found cached review for: {imdbId}");
                    return $"{cached.Author}|||{cached.Content}";
                }
                System.Diagnostics.Debug.WriteLine($"❌ [Reviewer] No cache found for: {imdbId}");
            }
            
            using var httpClient = new HttpClient();
            httpClient.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
            
            var url = $"https://www.imdb.com/title/{imdbId}/reviews";
            System.Diagnostics.Debug.WriteLine($"📡 [Reviewer] Fetching URL: {url}");
            
            var response = await httpClient.GetAsync(url);
            System.Diagnostics.Debug.WriteLine($"📊 [Reviewer] Response status: {response.StatusCode}");
            
            if (!response.IsSuccessStatusCode)
            {
                System.Diagnostics.Debug.WriteLine($"❌ [Reviewer] Failed to fetch page: {response.StatusCode}");
                return null;
            }
            
            var html = await response.Content.ReadAsStringAsync();
            System.Diagnostics.Debug.WriteLine($"📄 [Reviewer] HTML length: {html.Length} characters");
            
            // Save HTML to file for debugging
            try
            {
                var debugPath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"imdb_{imdbId}.html");
                await System.IO.File.WriteAllTextAsync(debugPath, html);
                System.Diagnostics.Debug.WriteLine($"💾 [Reviewer] Saved HTML to: {debugPath}");
            }
            catch { }
            
            // Modern IMDb embeds review data in JSON within the HTML
            // The data is in a JavaScript object, not JSON-LD
            var reviewMatch = Regex.Match(html, @"""reviewText""\s*:\s*""([^""]{50,}[^""]*)""", RegexOptions.Singleline);
            
            if (reviewMatch.Success)
            {
                var reviewText = reviewMatch.Groups[1].Value;
                System.Diagnostics.Debug.WriteLine($"✅ [Reviewer] Found review text, length: {reviewText.Length}");
                
                // Extract author username - look backwards from reviewText for author info
                var authorMatch = Regex.Match(html, @"""author""\s*:\s*\{[^\}]*""username""\s*:\s*\{[^\}]*""text""\s*:\s*""([^""]+)""", RegexOptions.Singleline);
                var author = authorMatch.Success ? authorMatch.Groups[1].Value : "Anonymous";
                
                // Extract rating - look for authorRating near the review
                var ratingMatch = Regex.Match(html, @"""authorRating""\s*:\s*(\d+)", RegexOptions.Singleline);
                var rating = ratingMatch.Success ? ratingMatch.Groups[1].Value : "";
                
                // First decode Unicode escapes in the HTML entity format (\u0026#39; -> &#39;)
                reviewText = System.Text.RegularExpressions.Regex.Replace(reviewText, @"\\u([0-9a-fA-F]{4})", 
                    m => ((char)int.Parse(m.Groups[1].Value, System.Globalization.NumberStyles.HexNumber)).ToString());
                author = System.Text.RegularExpressions.Regex.Replace(author, @"\\u([0-9a-fA-F]{4})", 
                    m => ((char)int.Parse(m.Groups[1].Value, System.Globalization.NumberStyles.HexNumber)).ToString());
                
                // Decode JSON escaped characters
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
                
                // Decode HTML entities (after all other escapes are handled)
                reviewText = System.Net.WebUtility.HtmlDecode(reviewText).Trim();
                author = System.Net.WebUtility.HtmlDecode(author).Trim();
                
                System.Diagnostics.Debug.WriteLine($"👤 [Reviewer] Author: {author}");
                System.Diagnostics.Debug.WriteLine($"⭐ [Reviewer] Rating: {rating}");
                System.Diagnostics.Debug.WriteLine($"📝 [Reviewer] Review preview: {(reviewText.Length > 100 ? reviewText.Substring(0, 100) + "..." : reviewText)}");
                
                // Cache the result
                if (_reviewCache != null)
                {
                    await _reviewCache.Set(imdbId, author, reviewText);
                    System.Diagnostics.Debug.WriteLine($"💾 [Reviewer] Cached review for: {imdbId}");
                }
                
                return $"{author}|||{rating}|||{reviewText}";
            }
            
            System.Diagnostics.Debug.WriteLine($"⚠️ [Reviewer] No review found in JSON, trying HTML patterns...");
            
            // Fallback: Extract review text using HTML patterns
            // Try pattern 1: reviewText content
            var matches = Regex.Matches(html, @"<div[^>]*reviewText[^>]*>(.*?)</div>", RegexOptions.Singleline | RegexOptions.IgnoreCase);
            System.Diagnostics.Debug.WriteLine($"🔎 [Reviewer] Pattern 1 (reviewText div): {matches.Count} matches");
            
            if (matches.Count == 0)
            {
                // Try pattern 2: content within review container
                matches = Regex.Matches(html, @"<div[^>]*class=""[^""]*content[^""]*""[^>]*>(.*?)</div>", RegexOptions.Singleline | RegexOptions.IgnoreCase);
                System.Diagnostics.Debug.WriteLine($"🔎 [Reviewer] Pattern 2 (content class): {matches.Count} matches");
            }
            
            if (matches.Count == 0)
            {
                // Try pattern 3: Old IMDb structure
                matches = Regex.Matches(html, @"<div class=""text show-more__control""[^>]*>(.*?)</div>", RegexOptions.Singleline);
                System.Diagnostics.Debug.WriteLine($"🔎 [Reviewer] Pattern 3 (text show-more__control): {matches.Count} matches");
            }
            
            if (matches.Count > 0)
            {
                // Find the longest match (likely the actual review, not menu items)
                var bestMatch = matches.Cast<Match>()
                    .OrderByDescending(m => m.Groups[1].Value.Length)
                    .FirstOrDefault();
                
                if (bestMatch != null)
                {
                    var reviewHtml = bestMatch.Groups[1].Value;
                    System.Diagnostics.Debug.WriteLine($"📝 [Reviewer] Raw review HTML length: {reviewHtml.Length}");
                    
                    // Remove HTML tags and decode entities
                    var reviewText = Regex.Replace(reviewHtml, "<.*?>", string.Empty);
                    reviewText = System.Net.WebUtility.HtmlDecode(reviewText).Trim();
                    System.Diagnostics.Debug.WriteLine($"📝 [Reviewer] Cleaned review length: {reviewText.Length}");
                    
                    // Skip if it's too short (likely not a real review)
                    if (reviewText.Length < 50)
                    {
                        System.Diagnostics.Debug.WriteLine($"⚠️ [Reviewer] Review too short ({reviewText.Length} chars), skipping");
                        return null;
                    }
                    
                    System.Diagnostics.Debug.WriteLine($"📝 [Reviewer] Review preview: {(reviewText.Length > 100 ? reviewText.Substring(0, 100) + "..." : reviewText)}");
                    
                    // Also try to get the author
                    var authorMatch = Regex.Match(html, @"<span class=""display-name-link""><a[^>]*>(.*?)</a>");
                    var author = authorMatch.Success ? System.Net.WebUtility.HtmlDecode(authorMatch.Groups[1].Value) : "Anonymous";
                    System.Diagnostics.Debug.WriteLine($"👤 [Reviewer] Author: {author}");
                    
                    // Cache the result
                    if (_reviewCache != null)
                    {
                        await _reviewCache.Set(imdbId, author, reviewText);
                        System.Diagnostics.Debug.WriteLine($"💾 [Reviewer] Cached review for: {imdbId}");
                    }
                    
                    return $"{author}|||{reviewText}";
                }
            }
            
            System.Diagnostics.Debug.WriteLine($"❌ [Reviewer] No review matches found in HTML");
            // Let's also try to find what review structure exists
            var divMatches = Regex.Matches(html, @"<div[^>]*class=""[^""]*review[^""]*""[^>]*>", RegexOptions.IgnoreCase);
            System.Diagnostics.Debug.WriteLine($"🔎 [Reviewer] Found {divMatches.Count} divs with 'review' in class name");
            
            return null;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"❌ [Reviewer] Exception: {ex.Message}");
            System.Diagnostics.Debug.WriteLine($"❌ [Reviewer] Stack trace: {ex.StackTrace}");
            return null;
        }
    }

    /// <inheritdoc />
    public override string Name => "Reviewer";

    /// <inheritdoc />
    public override string Description => "Adds a custom section to movie detail pages";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("639b5171-918b-4b24-82e4-d35c10be63a4");
}