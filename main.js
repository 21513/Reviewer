(function() {
    'use strict';
    
    console.log('🎬 Reviewer Plugin: Script loaded');
    
    const htmlTemplate = `{{HTML_TEMPLATE}}`;
    
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
                const parts = reviewData.split('|||');
                console.log('📊 [Reviewer] Split into', parts.length, 'parts');
                console.log('👤 [Reviewer] Author (length=' + parts[0].length + '):', parts[0]);
                console.log('⭐ [Reviewer] Rating (length=' + (parts[1] ? parts[1].length : 0) + '):', parts[1]);
                console.log('📝 [Reviewer] Content (length=' + (parts[2] ? parts[2].length : 0) + ', first 100):', parts[2] ? parts[2].substring(0, 100) : 'N/A');
                
                return {
                    author: parts[0] || 'Anonymous',
                    rating: parts[1] || '',
                    content: parts[2] || parts[1] || reviewData
                };
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
        
        const detailWrapper = document.querySelector('.detailPageWrapperContainer');
        const detailPrimary = document.querySelector('.detailPagePrimaryContent');
        const detailRibbon = document.querySelector('.detailRibbon');
        
        let targetContainer = null;
        let insertPosition = null;
        
        if (detailPrimary) {
            targetContainer = detailPrimary;
            insertPosition = detailPrimary.firstChild;
            console.log('📍 Found detailPagePrimaryContent');
        } else if (detailRibbon && detailRibbon.parentElement) {
            targetContainer = detailRibbon.parentElement;
            insertPosition = detailRibbon.nextSibling;
            console.log('📍 Found detailRibbon');
        } else if (detailWrapper) {
            targetContainer = detailWrapper;
            insertPosition = detailWrapper.firstChild;
            reviewerDiv.dataset.itemId = itemId;  // Store item ID on the div
            console.log('📍 Found detailWrapper');
        }
        
        if (targetContainer) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlTemplate;
            const reviewerDiv = tempDiv.firstElementChild;
            
            if (insertPosition) {
                targetContainer.insertBefore(reviewerDiv, insertPosition);
            } else {
                targetContainer.appendChild(reviewerDiv);
            }
            console.log('✅ Reviewer Plugin: Injected div into movie page');
            
            reviewerDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: #aaa;">Loading IMDb review...</div>';
            
            const movieData = await getMovieData(itemId);
            console.log('🎬 [Reviewer] Movie data:', movieData);
            
            if (movieData && movieData.ProviderIds && movieData.ProviderIds.Imdb) {
                const imdbId = movieData.ProviderIds.Imdb;
                console.log('🎬 [Reviewer] IMDb ID:', imdbId);
                
                const review = await fetchImdbReview(imdbId);
                if (review) {
                    console.log('✅ [Reviewer] Successfully loaded review');
                    const ratingText = review.rating ? ` <span style="color: #ffc107;">${review.rating}/10</span>` : '';
                    
                    reviewerDiv.innerHTML = `
                        <div style="padding: 20px;">
                            <h3 style="margin: 0 0 10px 0; color: #fff;">IMDb Review</h3>
                            <div style="margin-bottom: 10px; color: #aaa; font-size: 14px;">
                                by <strong>${review.author}</strong>${ratingText}
                            </div>
                            <div id="review-container-${itemId}" style="position: relative;">
                                <div id="review-text-${itemId}" style="color: #ddd; line-height: 1.4; max-height: 150px; overflow: hidden; transition: max-height 0.3s ease;">
                                    ${review.content}
                                </div>
                                <button id="review-toggle-${itemId}" style="display: none; background: none; border: none; color: #00a4dc; cursor: pointer; padding: 5px 0; font-size: 14px; text-decoration: underline; margin-top: 5px;">Read more</button>
                            </div>
                        </div>
                    `;
                    
                    // Check if content overflows and add toggle functionality
                    const textDiv = reviewerDiv.querySelector(`#review-text-${itemId}`);
                    const toggleBtn = reviewerDiv.querySelector(`#review-toggle-${itemId}`);
                    
                    if (textDiv && toggleBtn) {
                        // Check if content is taller than max-height
                        if (textDiv.scrollHeight > textDiv.clientHeight) {
                            toggleBtn.style.display = 'inline-block';
                            let expanded = false;
                            
                            toggleBtn.addEventListener('click', () => {
                                expanded = !expanded;
                                textDiv.style.maxHeight = expanded ? 'none' : '150px';
                                toggleBtn.textContent = expanded ? 'Read less' : 'Read more';
                            });
                        }
                    }
                } else {
                    console.log('❌ [Reviewer] No review available');
                    reviewerDiv.innerHTML = '<div style="padding: 20px; color: #999;">No IMDb review available</div>';
                }
            } else {
                console.log('❌ [Reviewer] No IMDb ID found in movie data');
                reviewerDiv.innerHTML = '<div style="padding: 20px; color: #999;">No IMDb ID available for this movie</div>';
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
