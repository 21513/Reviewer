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

    public string? Get(string imdbId)
    {
        if (_cache.TryGetValue(imdbId, out var cacheEntry))
        {
            // Validate cached data
            if (cacheEntry.Reviews == null || cacheEntry.Reviews.Count == 0)
            {
                _cache.Remove(imdbId);
                return null;
            }
            
            // Cache is persistent - no expiration check
            // Reconstruct the response string from individual reviews
            var reviewStrings = new List<string>();
            foreach (var (author, reviewData) in cacheEntry.Reviews)
            {
                // Validate each review entry
                if (reviewData != null && !string.IsNullOrEmpty(reviewData.Content))
                {
                    reviewStrings.Add($"{author}|||{reviewData.Rating}|||{reviewData.Content}");
                }
            }
            
            if (reviewStrings.Count == 0)
            {
                _cache.Remove(imdbId);
                return null;
            }
            
            return string.Join("@@@", reviewStrings);
        }
        return null;
    }

    public async Task Set(string imdbId, string reviewData)
    {
        // Parse the reviewData string into individual reviews
        var reviews = new Dictionary<string, ReviewData>();
        var reviewBlocks = reviewData.Split("@@@");
        
        foreach (var block in reviewBlocks)
        {
            var parts = block.Split("|||");
            if (parts.Length >= 3)
            {
                var author = parts[0];
                var rating = parts[1];
                var content = parts[2];
                
                reviews[author] = new ReviewData
                {
                    Rating = rating,
                    Content = content
                };
            }
        }
        
        _cache[imdbId] = new CachedReview
        {
            Reviews = reviews,
            CachedAt = DateTime.UtcNow
        };
        await SaveCache();
    }
}

public class CachedReview
{
    public Dictionary<string, ReviewData> Reviews { get; set; } = new Dictionary<string, ReviewData>();
    public DateTime CachedAt { get; set; }
}

public class ReviewData
{
    public string Rating { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
}
