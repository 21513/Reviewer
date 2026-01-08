using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Reviewer;

/// <summary>
/// Review API controller.
/// </summary>
[ApiController]
[Route("Reviewer")]
public class ReviewController : ControllerBase
{
    private readonly ILogger<ReviewController> _logger;

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
    [AllowAnonymous]
    public async Task<ActionResult<string>> GetReview([FromQuery] string imdbId)
    {
        _logger.LogInformation("🔍 [Reviewer] GetReview API called with IMDb ID: {ImdbId}", imdbId);
        
        if (string.IsNullOrEmpty(imdbId))
        {
            _logger.LogWarning("❌ [Reviewer] No IMDb ID provided");
            return BadRequest("IMDb ID is required");
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
}
