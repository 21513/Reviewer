using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;

namespace Reviewer;

/// <summary>
/// Manages caching of scraped reviews.
/// </summary>
public class ReviewCache
{
    private readonly string _cacheFilePath;
    private Dictionary<string, CachedReview> _cache = new Dictionary<string, CachedReview>();

    public ReviewCache(string dataPath)
    {
        _cacheFilePath = Path.Combine(dataPath, "review-cache.json");
        LoadCache();
    }

    private void LoadCache()
    {
        try
        {
            if (File.Exists(_cacheFilePath))
            {
                var json = File.ReadAllText(_cacheFilePath);
                _cache = JsonSerializer.Deserialize<Dictionary<string, CachedReview>>(json) 
                         ?? new Dictionary<string, CachedReview>();
            }
            else
            {
                _cache = new Dictionary<string, CachedReview>();
            }
        }
        catch
        {
            _cache = new Dictionary<string, CachedReview>();
        }
    }

    public async Task SaveCache()
    {
        try
        {
            var json = JsonSerializer.Serialize(_cache, new JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(_cacheFilePath, json);
        }
        catch
        {
            // Ignore save errors
        }
    }

    public CachedReview? Get(string imdbId)
    {
        if (_cache.TryGetValue(imdbId, out var review))
        {
            // Check if cache is still valid (30 days)
            if ((DateTime.UtcNow - review.CachedAt).TotalDays < 30)
            {
                return review;
            }
        }
        return null;
    }

    public async Task Set(string imdbId, string author, string content)
    {
        _cache[imdbId] = new CachedReview
        {
            Author = author,
            Content = content,
            CachedAt = DateTime.UtcNow
        };
        await SaveCache();
    }
}

public class CachedReview
{
    public string Author { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public DateTime CachedAt { get; set; }
}
