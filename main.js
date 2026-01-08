(function() {
    'use strict';
    
    console.log('🎬 Reviewer Plugin: Script loaded');
    
    const htmlTemplate = `{{HTML_TEMPLATE}}`;
    
    // Extract CSS from template to inject separately
    const cssMatch = htmlTemplate.match(/<style>([\s\S]*?)<\/style>/);
    const cssStyles = cssMatch ? cssMatch[1] : '';
    
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
            const serverAddress = apiClient.serverAddress();
            const url = `${serverAddress}/Reviewer/GetReview?imdbId=${imdbId}`;
            
            console.log('📡 [Reviewer] API URL:', url);
            
            const response = await fetch(url);
            console.log('📊 [Reviewer] Response status:', response.status, response.statusText);
            
            if (!response.ok) {
                console.log('⚠️ [Reviewer] Review API response not ok:', response.status);
                const errorText = await response.text();
                console.log('⚠️ [Reviewer] Error response:', errorText);
                return null;
            }
            
            const reviewData = await response.text();
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
                            </div>
                            <div class="reviewsContainer">
                        `;
                    
                    reviews.forEach((review, index) => {
                        const ratingText = review.rating ? ` <span style="color: #ffc107;">${review.rating}/10</span>` : '';
                        const reviewId = `${itemId}-${index}`;
                        
                        reviewsHtml += `
                            <div class="reviewContainer" style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #333;">
                                <div style="margin-bottom: 10px; color: #aaa; font-size: 14px;">
                                    by <strong>${review.author}</strong>${ratingText}
                                </div>
                                <div id="review-container-${reviewId}" style="position: relative;">
                                    <div id="review-text-${reviewId}" style="color: #ddd; line-height: 1.4; max-height: 150px; overflow: hidden; transition: max-height 0.3s ease;">
                                        ${review.content}
                                    </div>
                                    <button id="review-toggle-${reviewId}" style="display: none; background: none; border: none; color: #00a4dc; cursor: pointer; padding: 5px 0; font-size: 14px; text-decoration: underline; margin-top: 5px;">Read more</button>
                                </div>
                            </div>
                        `;
                    });
                    
                    reviewsHtml += '</div>';
                    reviewerDiv.innerHTML = `<style>${cssStyles}</style>` + reviewsHtml;
                    
                    // Add modal functionality for each review
                    reviews.forEach((review, index) => {
                        const reviewId = `${itemId}-${index}`;
                        const textDiv = reviewerDiv.querySelector(`#review-text-${reviewId}`);
                        const toggleBtn = reviewerDiv.querySelector(`#review-toggle-${reviewId}`);
                        
                        if (textDiv && toggleBtn) {
                            // Check if content is taller than max-height
                            if (textDiv.scrollHeight > textDiv.clientHeight) {
                                toggleBtn.style.display = 'inline-block';
                                
                                toggleBtn.addEventListener('click', () => {
                                    // Create modal overlay
                                    const modal = document.createElement('div');
                                    modal.className = 'review-modal-overlay';
                                    modal.innerHTML = `
                                        <div class="review-modal-content">
                                            <div class="review-modal-header">
                                                <div>
                                                    <strong style="font-size: 1.1em;">${review.author}</strong>
                                                    ${review.rating ? `<span style="color: #ffc107; margin-left: 10px;">${review.rating}/10</span>` : ''}
                                                </div>
                                                <button class="review-modal-close" title="Close">&times;</button>
                                            </div>
                                            <div class="review-modal-body">
                                                ${review.content}
                                            </div>
                                        </div>
                                    `;
                                    
                                    document.body.appendChild(modal);
                                    
                                    // Close on background click or close button
                                    const closeModal = () => {
                                        modal.remove();
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
