using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;

namespace Reviewer;

/// <summary>
/// Manages caching of Spotify stream counts.
/// </summary>
public class StreamCountCache
{
    private readonly string _cacheFilePath;
    private Dictionary<string, Dictionary<string, CachedStreamCount>> _cache = new Dictionary<string, Dictionary<string, CachedStreamCount>>();

    public StreamCountCache(string dataPath)
    {
        _cacheFilePath = Path.Combine(dataPath, "stream-count-cache.json");
        LoadCache();
    }

    private void LoadCache()
    {
        try
        {
            if (File.Exists(_cacheFilePath))
            {
                var json = File.ReadAllText(_cacheFilePath);
                _cache = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, CachedStreamCount>>>(json) 
                         ?? new Dictionary<string, Dictionary<string, CachedStreamCount>>();
            }
            else
            {
                _cache = new Dictionary<string, Dictionary<string, CachedStreamCount>>();
            }
        }
        catch
        {
            _cache = new Dictionary<string, Dictionary<string, CachedStreamCount>>();
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

    public string? Get(string albumId, string trackId)
    {
        if (_cache.TryGetValue(albumId, out var albumCache) && 
            albumCache.TryGetValue(trackId, out var cacheEntry))
        {
            // Validate cached data
            if (string.IsNullOrEmpty(cacheEntry.StreamCount))
            {
                albumCache.Remove(trackId);
                return null;
            }
            
            // Check if cache is older than 7 days (stream counts change frequently)
            if ((DateTime.UtcNow - cacheEntry.CachedAt).TotalDays <= 7)
            {
                // Reconstruct the response string
                return $"{cacheEntry.StreamCount}";
            }
            else
            {
                // Remove stale cache entry
                albumCache.Remove(trackId);
            }
        }
        return null;
    }

    public async Task Set(string albumId, string trackId, string streamData)
    {
        // Parse the streamData string
        var parts = streamData.Split("|||");
        
        if (parts.Length >= 4)
        {
            if (!_cache.ContainsKey(albumId))
            {
                _cache[albumId] = new Dictionary<string, CachedStreamCount>();
            }
            
            _cache[albumId][trackId] = new CachedStreamCount
            {
                StreamCount = parts[0],
                CachedAt = DateTime.UtcNow
            };
            
            await SaveCache();
        }
    }
}

public class CachedStreamCount
{
    public string StreamCount { get; set; } = string.Empty;
    public DateTime CachedAt { get; set; }
}
