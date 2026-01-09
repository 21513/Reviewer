using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Reviewer;

/// <summary>
/// Review API controller.
/// </summary>
[ApiController]
[Authorize]
[Route("Reviewer")]
public class ReviewController : ControllerBase
{
    private readonly ILogger<ReviewController> _logger;
    private static readonly Regex ImdbIdPattern = new Regex(@"^tt\d{7,8}$", RegexOptions.Compiled);

    public ReviewController(ILogger<ReviewController> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Get IMDb review for a movie.
    /// </summary>
    /// <param name="imdbId">The IMDb ID.</param>
    /// <returns>Review text.</returns>
    [HttpGet("GetReview")]
    public async Task<ActionResult<string>> GetReview([FromQuery] string imdbId)
    {
        _logger.LogInformation("🔍 [Reviewer] GetReview API called with IMDb ID: {ImdbId}", imdbId);
        
        if (string.IsNullOrEmpty(imdbId))
        {
            _logger.LogWarning("❌ [Reviewer] No IMDb ID provided");
            return BadRequest("IMDb ID is required");
        }
        
        // Validate IMDb ID format (must be tt followed by 7-8 digits)
        if (!ImdbIdPattern.IsMatch(imdbId))
        {
            _logger.LogWarning("❌ [Reviewer] Invalid IMDb ID format: {ImdbId}", imdbId);
            return BadRequest("Invalid IMDb ID format. Expected format: tt1234567");
        }
        
        var review = await Plugin.ScrapeImdbReview(imdbId);
        
        if (review == null)
        {
            _logger.LogWarning("❌ [Reviewer] No review found for IMDb ID: {ImdbId}", imdbId);
            return NotFound("No review found");
        }
        
        _logger.LogInformation("✅ [Reviewer] Review found for IMDb ID: {ImdbId}", imdbId);
        return Content(review, "text/plain");
    }

    /// <summary>
    /// Get Spotify stream count for a track.
    /// </summary>
    /// <param name="albumId">The Jellyfin album ID.</param>
    /// <param name="trackId">The Jellyfin track ID.</param>
    /// <param name="spotifyId">The Spotify track ID (optional if trackName and artistName provided).</param>
    /// <param name="trackName">The track name (optional if spotifyId provided).</param>
    /// <param name="artistName">The artist name (optional if spotifyId provided).</param>
    /// <returns>Stream count data.</returns>
    [HttpGet("GetStreamCount")]
    public async Task<ActionResult<string>> GetStreamCount([FromQuery] string? albumId = null, [FromQuery] string? trackId = null, [FromQuery] string? spotifyId = null, [FromQuery] string? trackName = null, [FromQuery] string? artistName = null)
    {
        _logger.LogInformation("🎵 [Reviewer] GetStreamCount API called - Album ID: {AlbumId}, Track ID: {TrackId}, Spotify ID: {SpotifyId}, Track: {TrackName}, Artist: {ArtistName}", 
            albumId ?? "null", trackId ?? "null", spotifyId ?? "null", trackName ?? "null", artistName ?? "null");
        
        if (string.IsNullOrEmpty(spotifyId) && (string.IsNullOrEmpty(trackName) || string.IsNullOrEmpty(artistName)))
        {
            _logger.LogWarning("❌ [Reviewer] Either Spotify ID or both track name and artist name required");
            return BadRequest("Either Spotify ID or both track name and artist name required");
        }
        
        var streamData = await Plugin.ScrapeStreamCount(albumId, trackId, spotifyId, trackName, artistName);
        
        if (streamData == null)
        {
            _logger.LogWarning("❌ [Reviewer] No stream data found - Album ID: {AlbumId}, Track ID: {TrackId}, Spotify ID: {SpotifyId}, Track: {TrackName}, Artist: {ArtistName}", 
                albumId ?? "null", trackId ?? "null", spotifyId ?? "null", trackName ?? "null", artistName ?? "null");
            return NotFound("No stream data found");
        }
        
        _logger.LogInformation("✅ [Reviewer] Stream data found");
        return Content(streamData, "text/plain");
    }
}
