(function() {
    'use strict';
    
    console.log('🎬 Reviewer Plugin: Script loaded');
    
    const htmlTemplate = `{{HTML_TEMPLATE}}`;
    
    // Extract CSS from template to inject separately
    const cssMatch = htmlTemplate.match(/<style>([\s\S]*?)<\/style>/);
    const cssStyles = cssMatch ? cssMatch[1] : '';
    
    // HTML escape function to prevent XSS
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    async function getMovieData(itemId) {
        try {
            const apiClient = window.ApiClient;
            if (!apiClient) {
                console.error('❌ ApiClient not available');
                return null;
            }
            
            const item = await apiClient.getItem(apiClient.getCurrentUserId(), itemId);
            console.log('📊 Movie data:', item);
            return item;
        } catch (error) {
            console.error('❌ Error fetching movie data:', error);
            return null;
        }
    }
    
    async function fetchImdbReview(imdbId) {
        try {
            console.log('🔍 [Reviewer] Fetching IMDb review for:', imdbId);
            
            const apiClient = window.ApiClient;
            const url = `Reviewer/GetReview?imdbId=${imdbId}`;
            
            console.log('📡 [Reviewer] API URL:', url);
            
            // Use ApiClient's ajax method which handles authentication automatically
            const reviewData = await apiClient.ajax({
                type: 'GET',
                url: apiClient.getUrl(url),
                dataType: 'text'
            });
            
            console.log('📊 [Reviewer] Response received');
            console.log('📊 [Reviewer] Review data received, length:', reviewData.length);
            console.log('📊 [Reviewer] Raw response (first 200 chars):', reviewData.substring(0, 200));
            
            if (reviewData) {
                // Split by @@@ to get multiple reviews
                const reviewBlocks = reviewData.split('@@@');
                console.log('📊 [Reviewer] Found', reviewBlocks.length, 'review(s)');
                
                const reviews = reviewBlocks.map((block, index) => {
                    const parts = block.split('|||');
                    console.log(`📊 [Reviewer] Review ${index + 1}: ${parts[0]} - ${parts[1]}/10`);
                    return {
                        author: parts[0] || 'Anonymous',
                        rating: parts[1] || '',
                        content: parts[2] || parts[1] || block
                    };
                });
                
                return reviews;
            }
            
            console.log('❌ [Reviewer] No review data returned');
            return null;
        } catch (error) {
            console.error('❌ [Reviewer] Error fetching IMDb review:', error);
            console.error('❌ [Reviewer] Error stack:', error.stack);
            return null;
        }
    }
    
    function initializeReviewScrollButtons(container) {
        const scrollContainer = container.querySelector('.reviewsContainer');
        const leftBtn = container.querySelector('.reviewerScrollLeft');
        const rightBtn = container.querySelector('.reviewerScrollRight');
        
        if (!scrollContainer || !leftBtn || !rightBtn) {
            console.log('⚠️ Review scroll elements not found');
            return;
        }
        
        const scrollAmount = 1088; // (512px width + 32px gap) * 2
        
        function updateButtonStates() {
            const scrollLeft = scrollContainer.scrollLeft;
            const maxScroll = scrollContainer.scrollWidth - scrollContainer.clientWidth;
            
            // Disable left button if at start
            if (scrollLeft <= 0) {
                leftBtn.setAttribute('disabled', '');
            } else {
                leftBtn.removeAttribute('disabled');
            }
            
            // Disable right button if at end
            if (scrollLeft >= maxScroll - 1) {
                rightBtn.setAttribute('disabled', '');
            } else {
                rightBtn.removeAttribute('disabled');
            }
        }
        
        const scrollLeft = () => {
            scrollContainer.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
            setTimeout(updateButtonStates, 300);
        };
        
        const scrollRight = () => {
            scrollContainer.scrollBy({ left: scrollAmount, behavior: 'smooth' });
            setTimeout(updateButtonStates, 300);
        };
        
        leftBtn.addEventListener('click', scrollLeft);
        rightBtn.addEventListener('click', scrollRight);
        
        scrollContainer.addEventListener('scroll', updateButtonStates);
        
        // Initial state
        updateButtonStates();
        
        console.log('✅ Review scroll buttons initialized');
    }
    
    async function injectOnMoviePage() {
        console.log('🔍 Checking for movie page...', window.location.hash);
        
        const isDetailPage = window.location.hash.includes('/details?id=');
        
        if (!isDetailPage) {
            console.log('❌ Not a detail page');
            return;
        }
        
        const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
        const itemId = urlParams.get('id');
        
        if (!itemId) {
            console.log('❌ No item ID found in URL');
            return;
        }
        
        const existingDiv = document.getElementById('reviewer-black-div');
        // Check if the div exists and is for the same item
        if (existingDiv && existingDiv.dataset.itemId === itemId) {
            console.log('✅ Div already exists for this item');
            return;
        }
        
        // Remove div if it's for a different item
        if (existingDiv) {
            existingDiv.remove();
            console.log('🗑️ Removed existing div (different item)');
        }
        
        // Find the cast section to insert reviews before it
        const castSection = document.querySelector('#castCollapsible');
        
        let targetContainer = null;
        let insertPosition = null;
        
        if (castSection && castSection.parentElement) {
            targetContainer = castSection.parentElement;
            insertPosition = castSection;
            console.log('📍 Found castCollapsible - will insert reviews before Cast & Crew');
        } else {
            // Fallback to original logic if cast section not found
            const detailWrapper = document.querySelector('.detailPageWrapperContainer');
            const detailPrimary = document.querySelector('.detailPagePrimaryContent');
            const detailRibbon = document.querySelector('.detailRibbon');
            
            if (detailPrimary) {
                targetContainer = detailPrimary;
                insertPosition = detailPrimary.firstChild;
                console.log('📍 Found detailPagePrimaryContent (fallback)');
            } else if (detailRibbon && detailRibbon.parentElement) {
                targetContainer = detailRibbon.parentElement;
                insertPosition = detailRibbon.nextSibling;
                console.log('📍 Found detailRibbon (fallback)');
            } else if (detailWrapper) {
                targetContainer = detailWrapper;
                insertPosition = detailWrapper.firstChild;
                console.log('📍 Found detailWrapper (fallback)');
            }
        }
        
        if (targetContainer) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlTemplate;
            const reviewerDiv = tempDiv.firstElementChild;
            reviewerDiv.dataset.itemId = itemId;  // Store item ID on the div
            
            if (insertPosition) {
                targetContainer.insertBefore(reviewerDiv, insertPosition);
            } else {
                targetContainer.appendChild(reviewerDiv);
            }
            console.log('✅ Reviewer Plugin: Injected div into movie page');
            
            reviewerDiv.innerHTML = `<style>${cssStyles}</style><div style="padding: 20px; text-align: center; color: #aaa;">Loading IMDb reviews...</div>`;
            
            const movieData = await getMovieData(itemId);
            console.log('🎬 [Reviewer] Movie data:', movieData);
            
            if (movieData && movieData.ProviderIds && movieData.ProviderIds.Imdb) {
                const imdbId = movieData.ProviderIds.Imdb;
                console.log('🎬 [Reviewer] IMDb ID:', imdbId);
                
                const reviews = await fetchImdbReview(imdbId);
                if (reviews && reviews.length > 0) {
                    console.log('✅ [Reviewer] Successfully loaded', reviews.length, 'reviews');
                    
                    let reviewsHtml = `
                            <div class="reviewsSource">
                                <h2 class="sectionTitle sectionTitle-cards padded-right">
                                    IMDb Reviews
                                </h2>
                                <div class="reviewerScrollButtons">
                                    <button type="button" class="reviewerScrollLeft paper-icon-button-light" title="Previous">
                                        <span class="material-icons chevron_left" aria-hidden="true"></span>
                                    </button>
                                    <button type="button" class="reviewerScrollRight paper-icon-button-light" title="Next">
                                        <span class="material-icons chevron_right" aria-hidden="true"></span>
                                    </button>
                                </div>
                            </div>
                            <div class="reviewsContainer">
                        `;
                    
                    reviews.forEach((review, index) => {
                        const escapedAuthor = escapeHtml(review.author);
                        const escapedRating = escapeHtml(review.rating);
                        const escapedContent = escapeHtml(review.content).replace(/\n/g, '<br>');
                        const ratingText = review.rating ? `<span>${escapedRating}/10</span>`: '';
                        const reviewId = `${itemId}-${index}`;
                        
                        reviewsHtml += `
                            <div class="reviewContainer" style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #333;">
                                <div class="reviewDetails">
                                    <div style="margin-bottom: 4px; color: #aaa; font-size: 14px;">
                                        by <strong>${escapedAuthor}</strong>
                                    </div>
                                    <div style="margin-bottom: 4px;">
                                        <span class="material-icons starIcon star" aria-hidden="true"></span>
                                        ${ratingText}
                                    </div>
                                </div>
                                <div id="review-container-${reviewId}" style="position: relative;">
                                    <div class="reviewTextTruncated" id="review-text-${reviewId}">
                                        ${escapedContent}
                                    </div>
                                    <div class="readMoreContainer">
                                        <button id="review-toggle-${reviewId}" class="read-more-btn" style="display: none;">Read more...</button>
                                    </div>
                                </div>
                            </div>
                        `;
                    });
                    
                    reviewsHtml += '</div>';
                    reviewerDiv.innerHTML = `<style>${cssStyles}</style>` + reviewsHtml;
                    
                    // Initialize scroll buttons after DOM is ready
                    setTimeout(() => {
                        initializeReviewScrollButtons(reviewerDiv);
                    }, 100);
                    
                    // Add modal functionality for each review
                    reviews.forEach((review, index) => {
                        const reviewId = `${itemId}-${index}`;
                        const textDiv = reviewerDiv.querySelector(`#review-text-${reviewId}`);
                        const toggleBtn = reviewerDiv.querySelector(`#review-toggle-${reviewId}`);
                        
                        if (textDiv && toggleBtn) {
                            // Check if content is taller than max-height - need a small delay for proper measurement
                            setTimeout(() => {
                                if (textDiv.scrollHeight > textDiv.clientHeight) {
                                    toggleBtn.style.display = 'inline-block';
                                
                                toggleBtn.addEventListener('click', () => {
                                    // Create modal overlay
                                    const modal = document.createElement('div');
                                    modal.className = 'review-modal-overlay';
                                    const escapedAuthorModal = escapeHtml(review.author);
                                    const escapedRatingModal = escapeHtml(review.rating);
                                    const escapedContentModal = escapeHtml(review.content).replace(/\n/g, '<br>');
                                    
                                    modal.innerHTML = `
                                        <div class="review-modal-content">
                                            <div class="review-modal-header">
                                                <div>
                                                    <strong style="font-size: 1.1em;">${escapedAuthorModal}</strong>
                                                    ${review.rating ? `<span style="margin-left: 4px;">${escapedRatingModal}/10</span>` : ''}
                                                </div>
                                                <button class="review-modal-close" title="Close">&times;</button>
                                            </div>
                                            <div class="review-modal-body">
                                                ${escapedContentModal}
                                            </div>
                                        </div>
                                    `;
                                    
                                    document.body.appendChild(modal);
                                    
                                    // Disable scrolling on main page
                                    document.body.style.overflow = 'hidden';
                                    
                                    // Close on background click or close button
                                    const closeModal = () => {
                                        modal.remove();
                                        // Re-enable scrolling on main page
                                        document.body.style.overflow = '';
                                    };
                                    
                                    modal.addEventListener('click', (e) => {
                                        if (e.target === modal) closeModal();
                                    });
                                    
                                    modal.querySelector('.review-modal-close').addEventListener('click', closeModal);
                                    
                                    // Close on Escape key
                                    const escapeHandler = (e) => {
                                        if (e.key === 'Escape') {
                                            closeModal();
                                            document.removeEventListener('keydown', escapeHandler);
                                        }
                                    };
                                    document.addEventListener('keydown', escapeHandler);
                                });
                            }
                            }, 50);
                        }
                    });
                } else {
                    console.log('❌ [Reviewer] No review available');
                    reviewerDiv.innerHTML = `<style>${cssStyles}</style><div style="padding: 20px; color: #999;">No IMDb reviews available</div>`;
                }
            } else {
                console.log('❌ [Reviewer] No IMDb ID found in movie data');
                reviewerDiv.innerHTML = `<style>${cssStyles}</style><div style="padding: 20px; color: #999;">No IMDb ID available for this movie</div>`;
            }
        } else {
            console.log('❌ Could not find suitable container');
        }
    }
    
    document.addEventListener('viewshow', function(e) {
        console.log('📄 Page view changed', e.detail);
        setTimeout(injectOnMoviePage, 200);
    });
    
    window.addEventListener('hashchange', function() {
        console.log('🔗 Hash changed to:', window.location.hash);
        setTimeout(injectOnMoviePage, 200);
    });
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectOnMoviePage);
    } else {
        setTimeout(injectOnMoviePage, 500);
    }
    
    window.addEventListener('load', function() {
        console.log('🌐 Window loaded');
        setTimeout(injectOnMoviePage, 500);
    });
    
})();
