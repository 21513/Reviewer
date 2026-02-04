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

    private readonly Microsoft.Extensions.Logging.ILogger<StreamCountCache> _logger;

    public StreamCountCache(string dataPath, Microsoft.Extensions.Logging.ILogger<StreamCountCache> logger = null)
    {
        _logger = logger;
        _cacheFilePath = Path.Combine(dataPath, "stream-count-cache.json");
        _logger?.LogInformation("[Reviewer] StreamCountCache initializing with path: {Path}", _cacheFilePath);
        LoadCache();
    }

    private void LoadCache()
    {
        try
        {
            if (File.Exists(_cacheFilePath))
            {
                _logger?.LogInformation("[Reviewer] Loading existing stream count cache from: {Path}", _cacheFilePath);
                var json = File.ReadAllText(_cacheFilePath);
                _cache = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, CachedStreamCount>>>(json) 
                         ?? new Dictionary<string, Dictionary<string, CachedStreamCount>>();
                _logger?.LogInformation("[Reviewer] Loaded {Count} albums from cache", _cache.Count);
            }
            else
            {
                _logger?.LogInformation("[Reviewer] No existing cache file found at: {Path}, creating new cache", _cacheFilePath);
                _cache = new Dictionary<string, Dictionary<string, CachedStreamCount>>();
            }
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "[Reviewer] Error loading stream count cache from {Path}", _cacheFilePath);
            _cache = new Dictionary<string, Dictionary<string, CachedStreamCount>>();
        }
    }

    public async Task SaveCache()
    {
        try
        {
            _logger?.LogInformation("[Reviewer] Saving stream count cache to: {Path}", _cacheFilePath);
            var directory = Path.GetDirectoryName(_cacheFilePath);
            if (!Directory.Exists(directory))
            {
                _logger?.LogInformation("[Reviewer] Creating directory: {Directory}", directory);
                Directory.CreateDirectory(directory);
            }
            var json = JsonSerializer.Serialize(_cache, new JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(_cacheFilePath, json);
            _logger?.LogInformation("[Reviewer] Successfully saved stream count cache with {Count} albums", _cache.Count);
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "[Reviewer] Error saving stream count cache to {Path}", _cacheFilePath);
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
