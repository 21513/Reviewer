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
    private static StreamCountCache? _streamCountCache;

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
        
        // Initialize caches
        _reviewCache = new ReviewCache(DataFolderPath);
        _streamCountCache = new StreamCountCache(DataFolderPath);
        
        _logger.LogInformation("Reviewer Plugin: Starting initialization...");
        
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
            httpClient.MaxResponseContentBufferSize = 10 * 1024 * 1024; // 10MB limit
            
            var url = $"https://www.imdb.com/title/{imdbId}/reviews";
            
            var response = await httpClient.GetAsync(url);
            
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }
            
            // Check content length before reading
            if (response.Content.Headers.ContentLength > 10 * 1024 * 1024)
            {
                return null;
            }
            
            var html = await response.Content.ReadAsStringAsync();
            var timeout = TimeSpan.FromSeconds(2);
            var reviewsArrayMatch = Regex.Match(html, @"""reviews""\s*:\s*\[(.*?)\]", RegexOptions.Singleline, timeout);
            
            if (reviewsArrayMatch.Success)
            {
                var reviewsJson = reviewsArrayMatch.Groups[1].Value;
                
                // Extract up to 7 reviews
                var reviewMatches = Regex.Matches(reviewsJson, @"""reviewText""\s*:\s*""([^""]{50,}[^""]*)""", RegexOptions.Singleline, timeout);
                var authorMatches = Regex.Matches(reviewsJson, @"""author""\s*:\s*\{[^\}]*""username""\s*:\s*\{[^\}]*""text""\s*:\s*""([^""]+)""", RegexOptions.Singleline, timeout);
                var ratingMatches = Regex.Matches(reviewsJson, @"""authorRating""\s*:\s*(\d+)", RegexOptions.Singleline, timeout);
                
                var reviewsList = new List<string>();
                var reviewCount = Math.Min(7, reviewMatches.Count);
                
                for (int i = 0; i < reviewCount; i++)
                {
                    var reviewText = reviewMatches[i].Groups[1].Value;
                    var author = i < authorMatches.Count ? authorMatches[i].Groups[1].Value : "Anonymous";
                    var rating = i < ratingMatches.Count ? ratingMatches[i].Groups[1].Value : "";

                    reviewText = System.Text.RegularExpressions.Regex.Replace(reviewText, @"\\u([0-9a-fA-F]{4})", 
                        m => ((char)int.Parse(m.Groups[1].Value, System.Globalization.NumberStyles.HexNumber)).ToString(),
                        RegexOptions.None, TimeSpan.FromSeconds(1));
                    author = System.Text.RegularExpressions.Regex.Replace(author, @"\\u([0-9a-fA-F]{4})", 
                        m => ((char)int.Parse(m.Groups[1].Value, System.Globalization.NumberStyles.HexNumber)).ToString(),
                        RegexOptions.None, TimeSpan.FromSeconds(1));

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

            
            var matches = Regex.Matches(html, @"<div[^>]*reviewText[^>]*>(.*?)</div>", RegexOptions.Singleline | RegexOptions.IgnoreCase, timeout);
            
            if (matches.Count == 0)
            {
                matches = Regex.Matches(html, @"<div[^>]*class=""[^""]*content[^""]*""[^>]*>(.*?)</div>", RegexOptions.Singleline | RegexOptions.IgnoreCase, timeout);
            }
            
            if (matches.Count > 0)
            {
                var bestMatch = matches.Cast<Match>()
                    .OrderByDescending(m => m.Groups[1].Value.Length)
                    .FirstOrDefault();
                
                if (bestMatch != null)
                {
                    var reviewHtml = bestMatch.Groups[1].Value;
                    
                    var reviewText = Regex.Replace(reviewHtml, "<.*?>", string.Empty, RegexOptions.None, timeout);
                    reviewText = System.Net.WebUtility.HtmlDecode(reviewText).Trim();

                    if (reviewText.Length < 50)
                    {
                        return null;
                    }
                    
                    var authorMatch = Regex.Match(html, @"<span class=""display-name-link""><a[^>]*>(.*?)</a>", RegexOptions.None, timeout);
                    var author = authorMatch.Success ? System.Net.WebUtility.HtmlDecode(authorMatch.Groups[1].Value) : "Anonymous";
                    
                    var result = $"{author}||||||{reviewText}";
                    
                    if (_reviewCache != null)
                    {
                        await _reviewCache.Set(imdbId, result);
                    }
                    
                    return result;
                }
            }

            var divMatches = Regex.Matches(html, @"<div[^>]*class=""[^""]*review[^""]*""[^>]*>", RegexOptions.IgnoreCase);
            
            return null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    public static async Task<string?> ScrapeStreamCount(string? albumId, string? trackId, string? spotifyId, string? trackName = null, string? artistName = null)
    {
        try
        {
            var timeout = TimeSpan.FromSeconds(2);
            using var handler = new HttpClientHandler { UseCookies = true, CookieContainer = new System.Net.CookieContainer() };
            using var httpClient = new HttpClient(handler);
            httpClient.Timeout = TimeSpan.FromSeconds(10);
            httpClient.MaxResponseContentBufferSize = 5 * 1024 * 1024; // 5MB limit
            httpClient.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
            
            string? html = null;
            
            // Use albumId and trackId for cache - fallback to trackId only if no albumId
            string effectiveAlbumId = albumId ?? "unknown";
            string effectiveTrackId = trackId ?? spotifyId ?? $"{trackName}_{artistName}";
            
            // Check cache first
            if (_streamCountCache != null && !string.IsNullOrEmpty(effectiveTrackId))
            {
                var cached = _streamCountCache.Get(effectiveAlbumId, effectiveTrackId);
                if (cached != null)
                {
                    return cached;
                }
            }
            
            // If we have a Spotify ID, fetch directly
            if (!string.IsNullOrEmpty(spotifyId))
            {
                var url = $"https://www.mystreamcount.com/track/{spotifyId}";
                var response = await httpClient.GetAsync(url);
                
                if (response.IsSuccessStatusCode)
                {
                    html = await response.Content.ReadAsStringAsync();
                }
            }
            // Otherwise, search using track name and artist
            else if (!string.IsNullOrEmpty(trackName) && !string.IsNullOrEmpty(artistName))
            {
                // First, GET the main page to obtain CSRF token and cookies
                var homeResponse = await httpClient.GetAsync("https://www.mystreamcount.com/");
                if (!homeResponse.IsSuccessStatusCode)
                {
                    return null;
                }
                
                var homeHtml = await homeResponse.Content.ReadAsStringAsync();
                var csrfMatch = Regex.Match(homeHtml, @"<meta\s+name=""csrf-token""\s+content=""([^""]+)""", RegexOptions.None, timeout);
                
                if (!csrfMatch.Success)
                {
                    return null;
                }
                
                var csrfToken = csrfMatch.Groups[1].Value;
                
                // Now POST the search with CSRF token
                var searchQuery = $"{trackName} {artistName}";
                var formContent = new FormUrlEncodedContent(new[]
                {
                    new KeyValuePair<string, string>("track", searchQuery)
                });
                
                var request = new HttpRequestMessage(HttpMethod.Post, "https://www.mystreamcount.com/track");
                request.Content = formContent;
                request.Headers.Add("X-CSRF-TOKEN", csrfToken);
                request.Headers.Add("Referer", "https://www.mystreamcount.com/");
                
                var response = await httpClient.SendAsync(request);
                
                if (response.IsSuccessStatusCode)
                {
                    html = await response.Content.ReadAsStringAsync();
                    
                    // Check if we got search results (not redirected to a track page)
                    if (html.Contains("Found") && html.Contains("results"))
                    {
                        // Extract the first track link and fetch that page
                        var trackLinkMatch = Regex.Match(html, @"<a\s+href=""(https://www\.mystreamcount\.com/track/[a-zA-Z0-9]{22})""", RegexOptions.IgnoreCase, timeout);
                        
                        if (trackLinkMatch.Success)
                        {
                            var trackUrl = trackLinkMatch.Groups[1].Value;
                            
                            var trackResponse = await httpClient.GetAsync(trackUrl);
                            if (trackResponse.IsSuccessStatusCode)
                            {
                                html = await trackResponse.Content.ReadAsStringAsync();
                            }
                        }
                        else
                        {
                            return null;
                        }
                    }
                    // else: we were redirected directly to a track page, html already contains the track page
                }
            }
            else
            {
                return null;
            }
            
            if (string.IsNullOrEmpty(html))
            {
                return null;
            }
            
            // Extract stream count from the page
            // Pattern: <p class="text-3xl lg:text-4xl font-extrabold text-spotify-green stat-number">179,294,281</p>
            var streamCountMatch = Regex.Match(html, @"<p[^>]*class=""[^""]*stat-number[^""]*""[^>]*>\s*([\d,]+)\s*</p>", RegexOptions.IgnoreCase, timeout);
            
            if (!streamCountMatch.Success)
            {
                // Fallback to old pattern
                streamCountMatch = Regex.Match(html, @"TOTAL\s+STREAMS[\s\S]*?([\d,]+)", RegexOptions.IgnoreCase, timeout);
            }
            
            if (streamCountMatch.Success)
            {
                var streamCount = streamCountMatch.Groups[1].Value;
                
                // Extract track name and artist
                var titleMatch = Regex.Match(html, @"<h1[^>]*>([^<]+)</h1>", RegexOptions.None, timeout);
                var artistMatch = Regex.Match(html, @"<a[^>]*href=""/artist/[^""]+""[^>]*>([^<]+)</a>", RegexOptions.None, timeout);
                var releaseDateMatch = Regex.Match(html, @"Released\s+([^<]+)", RegexOptions.None, timeout);
                
                var parsedTrackName = titleMatch.Success ? System.Net.WebUtility.HtmlDecode(titleMatch.Groups[1].Value.Trim()) : (trackName ?? "Unknown Track");
                var parsedArtistName = artistMatch.Success ? System.Net.WebUtility.HtmlDecode(artistMatch.Groups[1].Value.Trim()) : (artistName ?? "Unknown Artist");
                var releaseDate = releaseDateMatch.Success ? releaseDateMatch.Groups[1].Value.Trim() : "";
                
                var result = $"{streamCount}|||{parsedTrackName}|||{parsedArtistName}|||{releaseDate}";
                
                // Cache the result
                if (_streamCountCache != null && !string.IsNullOrEmpty(effectiveTrackId))
                {
                    await _streamCountCache.Set(effectiveAlbumId, effectiveTrackId, result);
                }
                
                return result;
            }
            
            return null;
        }
        catch (Exception)
        {
            return null;
        }
    }
    /// <inheritdoc />
    public override string Name => "Reviewer";

    /// <inheritdoc />
    public override string Description => "Adds IMDb reviews for movies/TV and stream counts for music";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("909531ee-1a34-4730-800e-44316f07cbff");
}