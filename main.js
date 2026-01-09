(function() {
    'use strict';
    
    const htmlTemplate = `{{HTML_TEMPLATE}}`;

    const cssMatch = htmlTemplate.match(/<style>([\s\S]*?)<\/style>/);
    const cssStyles = cssMatch ? cssMatch[1] : '';

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function sanitizeAndFormatContent(text) {
        let sanitized = escapeHtml(text);

        sanitized = sanitized.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
        sanitized = sanitized.replace(/\n/g, '<br>');
        return sanitized;
    }
    
    async function getMovieData(itemId) {
        try {
            const apiClient = window.ApiClient;
            if (!apiClient) {
                return null;
            }
            
            const item = await apiClient.getItem(apiClient.getCurrentUserId(), itemId);
            return item;
        } catch (error) {
            return null;
        }
    }
    
    async function fetchImdbReview(imdbId) {
        try {
            console.log('[Reviewer] Fetching IMDb review for:', imdbId);
            
            const apiClient = window.ApiClient;
            const url = `Reviewer/GetReview?imdbId=${imdbId}`;

            const reviewData = await apiClient.ajax({
                type: 'GET',
                url: apiClient.getUrl(url),
                dataType: 'text'
            });
            
            console.log('[Reviewer] Response received');
            console.log('[Reviewer] Review data received, length:', reviewData.length);
            
            if (reviewData) {
                const reviewBlocks = reviewData.split('@@@');
                
                const reviews = reviewBlocks.map((block, index) => {
                    const parts = block.split('|||');
                    return {
                        author: parts[0] || 'Anonymous',
                        rating: parts[1] || '',
                        content: parts[2] || parts[1] || block
                    };
                });
                
                return reviews;
            }
            
            return null;
        } catch (error) {
            console.error('[Reviewer] Error fetching IMDb review:', error);
            console.error('[Reviewer] Error stack:', error.stack);
            return null;
        }
    }
    
    function initializeReviewScrollButtons(container) {
        const scrollContainer = container.querySelector('.reviewsContainer');
        const leftBtn = container.querySelector('.reviewerScrollLeft');
        const rightBtn = container.querySelector('.reviewerScrollRight');
        
        if (!scrollContainer || !leftBtn || !rightBtn) {
            return;
        }
        
        const scrollAmount = 1088;
        
        function updateButtonStates() {
            const scrollLeft = scrollContainer.scrollLeft;
            const maxScroll = scrollContainer.scrollWidth - scrollContainer.clientWidth;

            if (scrollLeft <= 0) {
                leftBtn.setAttribute('disabled', '');
            } else {
                leftBtn.removeAttribute('disabled');
            }

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

        updateButtonStates();
    }
    
    async function injectOnMoviePage() {
        const isDetailPage = window.location.hash.includes('/details?id=');
        
        if (!isDetailPage) {
            return;
        }
        
        const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
        const itemId = urlParams.get('id');
        
        if (!itemId) {
            return;
        }
        
        const existingDiv = document.getElementById('reviewer-black-div');
        if (existingDiv && existingDiv.dataset.itemId === itemId) {
            return;
        }
        
        if (existingDiv) {
            existingDiv.remove();
        }
        
        const castSection = document.querySelector('#castCollapsible');
        
        let targetContainer = null;
        let insertPosition = null;
        
        if (castSection && castSection.parentElement) {
            targetContainer = castSection.parentElement;
            insertPosition = castSection;
        } else {
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
            reviewerDiv.dataset.itemId = itemId;
            
            if (insertPosition) {
                targetContainer.insertBefore(reviewerDiv, insertPosition);
            } else {
                targetContainer.appendChild(reviewerDiv);
            }
            
            reviewerDiv.innerHTML = `<style>${cssStyles}</style><div style="padding: 20px; text-align: center; color: #aaa;">Loading IMDb reviews...</div>`;
            
            const movieData = await getMovieData(itemId);
            console.log('[Reviewer] Movie data:', movieData);
            
            // Only show reviews for movies and TV shows (Series, Season, Episode)
            const allowedTypes = ['Movie', 'Series', 'Season', 'Episode'];
            if (!movieData || !allowedTypes.includes(movieData.Type)) {
                console.log('[Reviewer] Item type not supported:', movieData?.Type);
                reviewerDiv.remove();
                return;
            }
            
            if (movieData && movieData.ProviderIds && movieData.ProviderIds.Imdb) {
                const imdbId = movieData.ProviderIds.Imdb;
                console.log('[Reviewer] IMDb ID:', imdbId);
                
                const reviews = await fetchImdbReview(imdbId);
                if (reviews && reviews.length > 0) {
                    console.log('[Reviewer] Successfully loaded', reviews.length, 'reviews');
                    
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
                        const escapedContent = sanitizeAndFormatContent(review.content);
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
                                        <button id="review-toggle-${reviewId}" class="readMoreButton" style="display: none;">Read more...</button>
                                    </div>
                                </div>
                            </div>
                        `;
                    });
                    
                    reviewsHtml += '</div>';
                    reviewerDiv.innerHTML = `<style>${cssStyles}</style>` + reviewsHtml;
                    
                    setTimeout(() => {
                        initializeReviewScrollButtons(reviewerDiv);
                    }, 100);

                    reviews.forEach((review, index) => {
                        const reviewId = `${itemId}-${index}`;
                        const textDiv = reviewerDiv.querySelector(`#review-text-${reviewId}`);
                        const toggleBtn = reviewerDiv.querySelector(`#review-toggle-${reviewId}`);
                        
                        if (textDiv && toggleBtn) {
                            setTimeout(() => {
                                if (textDiv.scrollHeight > textDiv.clientHeight) {
                                    toggleBtn.style.display = 'inline-block';
                                
                                toggleBtn.addEventListener('click', () => {
                                    const modal = document.createElement('div');
                                    modal.className = 'reviewModalOverlay';
                                    const escapedAuthorModal = escapeHtml(review.author);
                                    const escapedRatingModal = escapeHtml(review.rating);
                                    const escapedContentModal = sanitizeAndFormatContent(review.content);
                                    
                                    modal.innerHTML = `
                                        <div class="reviewModalContent">
                                            <div class="reviewModalHeader">
                                                <div>
                                                    <strong style="font-size: 1.1em;">${escapedAuthorModal}</strong>
                                                    ${review.rating ? `<span style="margin-left: 4px;">${escapedRatingModal}/10</span>` : ''}
                                                </div>
                                                <button class="reviewModalClose" title="Close">&times;</button>
                                            </div>
                                            <div class="reviewModalBody">
                                                ${escapedContentModal}
                                            </div>
                                        </div>
                                    `;
                                    
                                    document.body.appendChild(modal);

                                    document.body.style.overflow = 'hidden';

                                    const closeModal = () => {
                                        modal.remove();
                                        document.body.style.overflow = '';
                                    };
                                    
                                    modal.addEventListener('click', (e) => {
                                        if (e.target === modal) closeModal();
                                    });
                                    
                                    modal.querySelector('.reviewModalClose').addEventListener('click', closeModal);

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
                    reviewerDiv.innerHTML = `<style>${cssStyles}</style><div style="padding: 20px; color: #999;">No IMDb reviews available</div>`;
                }
            } else {
                reviewerDiv.innerHTML = `<style>${cssStyles}</style><div style="padding: 20px; color: #999;">No IMDb ID available for this movie</div>`;
            }
        }
    }
    
    document.addEventListener('viewshow', function(e) {
        setTimeout(injectOnMoviePage, 200);
    });
    
    window.addEventListener('hashchange', function() {
        setTimeout(injectOnMoviePage, 200);
    });
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectOnMoviePage);
    } else {
        setTimeout(injectOnMoviePage, 500);
    }
    
    window.addEventListener('load', function() {
        setTimeout(injectOnMoviePage, 500);
    });
    
})();
