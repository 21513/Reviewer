(function() {
    'use strict';
    
    const htmlTemplate = `{{HTML_TEMPLATE}}`;

    const cssMatch = htmlTemplate.match(/<style>([\s\S]*?)<\/style>/);
    const cssStyles = cssMatch ? cssMatch[1] : '';
    
    // Cache for stream counts
    const streamCountCache = new Map();
    
    // Cache for album total streams
    const albumTotalCache = new Map();
    
    // Track which albums are currently being processed
    const processingAlbums = new Set();

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
    
    async function fetchStreamCount(albumId, trackId, spotifyId, trackName, artistName) {
        try {
            // Check cache first
            const cacheKey = `${albumId || ''}_${trackId || ''}_${spotifyId || ''}_${trackName || ''}_${artistName || ''}`;
            if (streamCountCache.has(cacheKey)) {
                console.log('[Reviewer] Using cached stream count for track:', trackName);
                return streamCountCache.get(cacheKey);
            }
            
            console.log('[Reviewer] Fetching stream count - Album ID:', albumId, 'Track ID:', trackId, 'Spotify ID:', spotifyId, 'Track:', trackName, 'Artist:', artistName);
            
            const apiClient = window.ApiClient;
            
            // Build URL with available parameters
            let url = 'Reviewer/GetStreamCount?';
            const params = [];
            
            if (albumId) {
                params.push(`albumId=${encodeURIComponent(albumId)}`);
            }
            if (trackId) {
                params.push(`trackId=${encodeURIComponent(trackId)}`);
            }
            if (spotifyId) {
                params.push(`spotifyId=${encodeURIComponent(spotifyId)}`);
            }
            if (trackName) {
                params.push(`trackName=${encodeURIComponent(trackName)}`);
            }
            if (artistName) {
                params.push(`artistName=${encodeURIComponent(artistName)}`);
            }
            
            url += params.join('&');

            const streamData = await apiClient.ajax({
                type: 'GET',
                url: apiClient.getUrl(url),
                dataType: 'text'
            });
            
            console.log('[Reviewer] Stream data received:', streamData);
            
            if (streamData) {
                const parts = streamData.split('|||');
                const result = {
                    streamCount: parts[0] || '0',
                    trackName: parts[1] || '',
                    artistName: parts[2] || '',
                    releaseDate: parts[3] || ''
                };
                
                // Cache the result
                streamCountCache.set(cacheKey, result);
                
                return result;
            }
            
            return null;
        } catch (error) {
            console.error('[Reviewer] Error fetching stream count:', error);
            return null;
        }
    }
    
    // Rate limiting for API requests
    let requestQueue = [];
    let isProcessingQueue = false;
    
    // Inject CSS styles into page if not already present
    function injectStylesIfNeeded() {
        if (document.getElementById('reviewer-plugin-styles')) {
            return;
        }
        
        const styleElement = document.createElement('style');
        styleElement.id = 'reviewer-plugin-styles';
        styleElement.textContent = cssStyles;
        document.head.appendChild(styleElement);
    }
    
    async function processRequestQueue() {
        if (isProcessingQueue || requestQueue.length === 0) {
            return;
        }
        
        isProcessingQueue = true;
        
        while (requestQueue.length > 0) {
            const task = requestQueue.shift();
            try {
                await task();
            } catch (error) {
                console.error('[Reviewer] Error processing queued request:', error);
            }
            // Add 200ms delay between requests to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        isProcessingQueue = false;
    }
    
    async function injectStreamCountIntoTrackList() {
        // Ensure styles are injected into the page
        injectStylesIfNeeded();
        
        // Find all list items that are audio tracks
        const listItems = document.querySelectorAll('.listItem');
        
        if (!listItems || listItems.length === 0) {
            return;
        }
        
        const apiClient = window.ApiClient;
        if (!apiClient) {
            return;
        }
        
        // Collect all tracks that need processing
        const tracksToProcess = [];
        
        for (const listItem of listItems) {
            // Skip if already processed
            if (listItem.dataset.reviewerProcessed === 'true') {
                continue;
            }
            
            // Find buttons with data-id attribute (these contain the item ID)
            const button = listItem.querySelector('[data-id][data-itemtype="Audio"]');
            if (!button) {
                continue;
            }
            
            const itemId = button.getAttribute('data-id');
            if (!itemId) {
                continue;
            }
            
            // Mark as processed immediately to prevent duplicate processing
            listItem.dataset.reviewerProcessed = 'true';
            
            tracksToProcess.push({ listItem, itemId });
        }
        
        // Process all tracks in parallel
        const processPromises = tracksToProcess.map(async ({ listItem, itemId }) => {
            try {
                // Get track data
                const trackData = await apiClient.getItem(apiClient.getCurrentUserId(), itemId);
                
                if (!trackData) {
                    return;
                }
                
                // Get album ID and Spotify ID if available, otherwise use track/artist name
                const albumId = trackData.AlbumId || null;
                const spotifyId = trackData.ProviderIds?.Spotify || null;
                const trackName = trackData.Name || null;
                const artistName = trackData.AlbumArtist || trackData.Artists?.[0] || null;
                
                if (!spotifyId && (!trackName || !artistName)) {
                    return;
                }
                
                // Fetch stream count (will use cache if available)
                const streamData = await fetchStreamCount(albumId, itemId, spotifyId, trackName, artistName);
                
                if (!streamData) {
                    return;
                }
                
                // Find the title element and duration element
                const listItemBody = listItem.querySelector('.listItemBody');
                const mediaInfo = listItem.querySelector('.secondary.listItemMediaInfo');
                
                if (!mediaInfo || !listItemBody) {
                    return;
                }
                
                // Check if we already added stream count
                if (listItem.querySelector('.reviewerStreamCount')) {
                    return;
                }
                
                // Create stream count element
                const streamCountDiv = document.createElement('div');
                streamCountDiv.className = 'reviewerStreamCount';
                streamCountDiv.title = `${streamData.streamCount} Spotify streams`;
                streamCountDiv.innerHTML = `${escapeHtml(streamData.streamCount)}`;
                
                // Check screen size to determine placement
                const isSmallScreen = window.matchMedia('(max-width: 50em)').matches;
                
                if (isSmallScreen) {
                    // On small screens, place below the title
                    const titleDiv = listItemBody.querySelector('.listItemBodyText');
                    if (titleDiv) {
                        titleDiv.appendChild(streamCountDiv);
                    } else {
                        listItemBody.appendChild(streamCountDiv);
                    }
                } else {
                    // On larger screens, place in mediaInfo with flex layout
                    mediaInfo.style.display = 'flex';
                    mediaInfo.style.alignItems = 'center';
                    mediaInfo.style.gap = '15px';
                    mediaInfo.style.justifyContent = 'center';
                    
                    // Insert before the duration (first child)
                    mediaInfo.insertBefore(streamCountDiv, mediaInfo.firstChild);
                }
                
            } catch (error) {
                console.error('[Reviewer] Error processing track:', error);
            }
        });
        
        // Wait for all tracks to be processed
        await Promise.allSettled(processPromises);
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
    
    async function injectAlbumTotalStreams() {
        const isDetailPage = window.location.hash.includes('/details?id=');
        
        if (!isDetailPage) {
            return;
        }
        
        const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
        const itemId = urlParams.get('id');
        
        if (!itemId) {
            return;
        }
        
        const albumData = await getMovieData(itemId);
        console.log('[Reviewer] Album data:', albumData);
        
        // Only show total streams for MusicAlbum
        if (!albumData || albumData.Type !== 'MusicAlbum') {
            console.log('[Reviewer] Item type not MusicAlbum:', albumData?.Type);
            return;
        }
        
        // Check if already processing this album
        if (processingAlbums.has(itemId)) {
            console.log('[Reviewer] Already processing album:', itemId);
            return;
        }
        
        // Check if already injected - remove all existing instances first
        const existingGroups = document.querySelectorAll('.detailsGroupItem.totalStreamsGroup');
        if (existingGroups.length > 0) {
            // If any of them match the current item ID, we're already done
            for (const group of existingGroups) {
                if (group.dataset.itemId === itemId) {
                    console.log('[Reviewer] Total streams already displayed for this album');
                    return;
                }
                // Remove any old ones from different albums
                group.remove();
            }
        }
        
        // Mark as processing
        processingAlbums.add(itemId);
        
        const apiClient = window.ApiClient;
        if (!apiClient) {
            return;
        }
        
        try {
            // Get all tracks in the album
            const result = await apiClient.getItems(apiClient.getCurrentUserId(), {
                parentId: itemId,
                includeItemTypes: 'Audio',
                sortBy: 'IndexNumber',
                recursive: false
            });
            
            if (!result || !result.Items || result.Items.length === 0) {
                console.log('[Reviewer] No tracks found in album');
                return;
            }
            
            console.log(`[Reviewer] Found ${result.Items.length} tracks in album`);
            
            // Find target container - look for the genres group and insert after it
            const genresGroup = document.querySelector('.detailsGroupItem.genresGroup');
            if (!genresGroup) {
                console.log('[Reviewer] Genres group not found');
                return;
            }
            
            const parentContainer = genresGroup.parentElement;
            if (!parentContainer) {
                console.log('[Reviewer] Parent container not found');
                return;
            }
            
            // Create placeholder element
            const totalStreamsGroup = document.createElement('div');
            totalStreamsGroup.className = 'detailsGroupItem totalStreamsGroup';
            totalStreamsGroup.dataset.itemId = itemId;
            totalStreamsGroup.innerHTML = `
                <div class="totalStreamsLabel label">Total Streams</div>
                <div class="totalStreams content">
                    <span style="font-size: 0.9em;">Calculating...</span>
                </div>
            `;
            
            // Insert before genres group
            parentContainer.insertBefore(totalStreamsGroup, genresGroup);
            
            // Check if we have cached total for this album
            if (albumTotalCache.has(itemId)) {
                console.log('[Reviewer] Using cached album total');
                const cachedTotal = albumTotalCache.get(itemId);
                const totalStreamsContent = totalStreamsGroup.querySelector('.totalStreams.content');
                if (totalStreamsContent) {
                    if (cachedTotal.successCount > 0) {
                        const formattedTotal = cachedTotal.totalStreams.toLocaleString();
                        totalStreamsContent.innerHTML = `
                            <span style="font-weight: 500; white-space: nowrap;">${escapeHtml(formattedTotal)}</span>
                        `;
                    } else {
                        totalStreamsContent.innerHTML = `<span style="white-space: nowrap;">No stream data available</span>`;
                    }
                }
                return;
            }
            
            // Fetch stream counts for all tracks in parallel
            let totalStreams = 0;
            let successCount = 0;
            
            // Process all tracks in parallel
            const streamPromises = result.Items.map(async (track) => {
                const spotifyId = track.ProviderIds?.Spotify || null;
                const trackName = track.Name || null;
                const artistName = track.AlbumArtist || track.Artists?.[0] || null;
                
                if (!spotifyId && (!trackName || !artistName)) {
                    return null;
                }
                
                const streamData = await fetchStreamCount(itemId, track.Id, spotifyId, trackName, artistName);
                
                if (streamData && streamData.streamCount) {
                    // Remove commas and convert to number
                    const count = parseInt(streamData.streamCount.replace(/,/g, ''), 10);
                    if (!isNaN(count)) {
                        return count;
                    }
                }
                
                return null;
            });
            
            // Wait for all promises to resolve
            const results = await Promise.allSettled(streamPromises);
            
            // Sum up all successful results
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value !== null) {
                    totalStreams += result.value;
                    successCount++;
                }
            }
            
            console.log(`[Reviewer] Total streams calculated: ${totalStreams} from ${successCount} tracks`);
            
            // Cache the album total
            albumTotalCache.set(itemId, { totalStreams, successCount });
            
            // Update the display
            const totalStreamsContent = totalStreamsGroup.querySelector('.totalStreams.content');
            if (totalStreamsContent) {
                if (successCount > 0) {
                    // Format number with commas
                    const formattedTotal = totalStreams.toLocaleString();
                    totalStreamsContent.innerHTML = `
                        <span style="font-weight: 500; white-space: nowrap;">${escapeHtml(formattedTotal)}</span>
                    `;
                } else {
                    totalStreamsContent.innerHTML = `<span style="white-space: nowrap;">No stream data available</span>`;
                }
            }
            
        } catch (error) {
            console.error('[Reviewer] Error calculating total streams:', error);
        } finally {
            // Remove from processing set
            processingAlbums.delete(itemId);
        }
    }
    
    async function injectOnMusicPage() {
        const isDetailPage = window.location.hash.includes('/details?id=');
        
        if (!isDetailPage) {
            return;
        }
        
        const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
        const itemId = urlParams.get('id');
        
        if (!itemId) {
            return;
        }
        
        const existingDiv = document.getElementById('reviewer-stream-div');
        if (existingDiv && existingDiv.dataset.itemId === itemId) {
            return;
        }
        
        if (existingDiv) {
            existingDiv.remove();
        }
        
        const musicData = await getMovieData(itemId);
        console.log('[Reviewer] Music data:', musicData);
        
        // Only show stream counts for Audio items (individual tracks), not albums or artists
        if (!musicData || musicData.Type !== 'Audio') {
            console.log('[Reviewer] Item type not Audio track:', musicData?.Type);
            return;
        }
        
        // Get album ID and Spotify ID if available, otherwise use track/artist name
        const albumId = musicData.AlbumId || null;
        const spotifyId = musicData.ProviderIds?.Spotify || null;
        const trackName = musicData.Name || null;
        const artistName = musicData.AlbumArtist || musicData.Artists?.[0] || null;
        
        if (!spotifyId && (!trackName || !artistName)) {
            console.log('[Reviewer] No Spotify ID and insufficient track info');
            return;
        }
        
        console.log('[Reviewer] Track info - Album ID:', albumId, 'Track ID:', itemId, 'Spotify ID:', spotifyId, 'Name:', trackName, 'Artist:', artistName);
        
        // Find the target container
        const detailPrimary = document.querySelector('.detailPagePrimaryContent');
        const detailWrapper = document.querySelector('.detailPageWrapperContainer');
        
        let targetContainer = null;
        
        if (detailPrimary) {
            targetContainer = detailPrimary;
        } else if (detailWrapper) {
            targetContainer = detailWrapper;
        }
        
        if (targetContainer) {
            const streamDiv = document.createElement('div');
            streamDiv.id = 'reviewer-stream-div';
            streamDiv.dataset.itemId = itemId;
            streamDiv.style.padding = '20px';
            streamDiv.style.marginBottom = '20px';
            
            targetContainer.insertBefore(streamDiv, targetContainer.firstChild);
            
            streamDiv.innerHTML = `<style>${cssStyles}</style><div style="padding: 20px; text-align: center; color: #aaa;">Loading Spotify stream count...</div>`;
            
            const streamData = await fetchStreamCount(albumId, itemId, spotifyId, trackName, artistName);
            if (streamData) {
                console.log('[Reviewer] Successfully loaded stream data:', streamData);
                
                let streamHtml = `
                    <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                        <h2 class="sectionTitle sectionTitle-cards" style="margin-bottom: 15px;">
                            Spotify Streams
                        </h2>
                        <div style="display: flex; flex-direction: column; gap: 12px;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <span class="streamCountText">${escapeHtml(streamData.streamCount)}</span>
                            </div>`;
                
                if (streamData.releaseDate) {
                    streamHtml += `
                            <div style="color: #999; font-size: 14px;">
                                Released: ${escapeHtml(streamData.releaseDate)}
                            </div>`;
                }
                
                streamHtml += `
                            <div style="margin-top: 10px;">
                                <a href="https://www.mystreamcount.com/track/${spotifyId}" target="_blank" rel="noopener noreferrer" 
                                   style="color: #00a4dc; text-decoration: none; font-size: 13px;">
                                    View detailed analytics on MyStreamCount →
                                </a>
                            </div>
                        </div>
                    </div>
                `;
                
                streamDiv.innerHTML = `<style>${cssStyles}</style>` + streamHtml;
            } else {
                streamDiv.innerHTML = `<style>${cssStyles}</style><div style="padding: 20px; color: #999;">No stream data available on MyStreamCount</div>`;
            }
        }
    }
    
    document.addEventListener('viewshow', function(e) {
        setTimeout(injectOnMoviePage, 200);
        setTimeout(injectOnMusicPage, 200);
        setTimeout(injectAlbumTotalStreams, 200);
        setTimeout(injectStreamCountIntoTrackList, 500);
    });
    
    window.addEventListener('hashchange', function() {
        setTimeout(injectOnMoviePage, 200);
        setTimeout(injectOnMusicPage, 200);
        setTimeout(injectAlbumTotalStreams, 200);
        setTimeout(injectStreamCountIntoTrackList, 500);
    });
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            injectOnMoviePage();
            injectOnMusicPage();
            injectAlbumTotalStreams();
            setTimeout(injectStreamCountIntoTrackList, 500);
        });
    } else {
        setTimeout(injectOnMoviePage, 500);
        setTimeout(injectOnMusicPage, 500);
        setTimeout(injectAlbumTotalStreams, 500);
        setTimeout(injectStreamCountIntoTrackList, 800);
    }
    
    window.addEventListener('load', function() {
        setTimeout(injectOnMoviePage, 500);
        setTimeout(injectOnMusicPage, 500);
        setTimeout(injectAlbumTotalStreams, 500);
        setTimeout(injectStreamCountIntoTrackList, 800);
    });
    
    // Use MutationObserver to detect when track lists are dynamically loaded
    function setupMutationObserver() {
        if (!document.body) {
            console.log('[Reviewer] document.body not available yet, retrying...');
            setTimeout(setupMutationObserver, 100);
            return;
        }
        
        const observer = new MutationObserver((mutations) => {
            let shouldCheck = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1 && (node.classList?.contains('listItem') || node.querySelector?.('.listItem'))) {
                            shouldCheck = true;
                            break;
                        }
                    }
                }
                if (shouldCheck) break;
            }
            if (shouldCheck) {
                setTimeout(injectStreamCountIntoTrackList, 300);
            }
        });
        
        // Start observing the document body for changes
        try {
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            console.log('[Reviewer] MutationObserver started');
        } catch (error) {
            console.error('[Reviewer] Failed to setup MutationObserver:', error);
        }
    }
    
    // Setup observer when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupMutationObserver);
    } else {
        setupMutationObserver();
    }
    
})();
