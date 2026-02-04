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
    
    // Track which artists are currently being processed
    const processingArtists = new Set();

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function sanitizeAndFormatContent(text) {
        if (!text) return '';
        // First, escape all HTML
        let sanitized = escapeHtml(text);
        // Only allow line breaks - replace escaped <br> tags and newlines
        sanitized = sanitized.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
        sanitized = sanitized.replace(/\n/g, '<br>');
        // Remove any other HTML-like patterns that might have slipped through
        sanitized = sanitized.replace(/&lt;\/?[a-z][^&]*&gt;/gi, '');
        return sanitized;
    }
    
    // Validate that data is from authenticated session
    function isAuthenticated() {
        return window.ApiClient && window.ApiClient.getCurrentUserId && window.ApiClient.getCurrentUserId();
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
            if (!isAuthenticated()) {
                console.error('[Reviewer] Not authenticated');
                return null;
            }
            
            const apiClient = window.ApiClient;
            const url = `Reviewer/GetReview?imdbId=${encodeURIComponent(imdbId)}`;

            const reviewData = await apiClient.ajax({
                type: 'GET',
                url: apiClient.getUrl(url),
                dataType: 'text'
            });
            
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
            if (!isAuthenticated()) {
                console.error('[Reviewer] Not authenticated');
                return null;
            }
            
            // Check cache first
            const cacheKey = `${albumId || ''}_${trackId || ''}_${spotifyId || ''}_${trackName || ''}_${artistName || ''}`;
            if (streamCountCache.has(cacheKey)) {
                return streamCountCache.get(cacheKey);
            }
            
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
            
            if (streamData) {
                const parts = streamData.split('|||');
                const streamCount = parts[0] && parts[0].trim() ? parts[0].trim() : 'N/A';
                const result = {
                    streamCount: streamCount,
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
                if (streamData.streamCount && streamData.streamCount !== 'N/A') {
                    streamCountDiv.title = `${streamData.streamCount} Spotify streams`;
                }
                streamCountDiv.textContent = streamData.streamCount;
                
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

    // Helper: find or create a `.detailsGroupItem.totalStreamsGroup` for an itemId.
    function getOrCreateTotalGroup(itemId) {
        // prefer existing
        let group = document.querySelector(`.detailsGroupItem.totalStreamsGroup[data-item-id="${itemId}"]`);
        if (group) return group;

        const genresGroup = document.querySelector('.detailsGroupItem.genresGroup');
        if (genresGroup && genresGroup.parentElement) {
            const parent = genresGroup.parentElement;
            group = document.createElement('div');
            group.className = 'detailsGroupItem totalStreamsGroup';
            group.dataset.itemId = itemId;
            group.innerHTML = `
                <div class="totalStreamsLabel label">Total Streams</div>
                <div class="totalStreams content">
                    <span style="font-size: 0.9em;">Calculating...</span>
                </div>
            `;
            parent.insertBefore(group, genresGroup);
            return group;
        }

        // fallback: insert into .detailsGroups or detailPrimary
        const groupsContainer = document.querySelector('.detailsGroups');
        if (groupsContainer) {
            group = document.createElement('div');
            group.className = 'detailsGroupItem totalStreamsGroup';
            group.dataset.itemId = itemId;
            group.innerHTML = `
                <div class="totalStreamsLabel label">Total Streams</div>
                <div class="totalStreams content">
                    <span style="font-size: 0.9em;">Calculating...</span>
                </div>
            `;
            groupsContainer.insertBefore(group, groupsContainer.firstChild);
            return group;
        }

        return null;
    }

    // Helper: update total group with a formatted number, retrying briefly if Jellyfin re-renders.
    async function updateTotalGroupWithRetry(itemId, formattedText) {
        const maxAttempts = 6;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            let group = document.querySelector(`.detailsGroupItem.totalStreamsGroup[data-item-id="${itemId}"]`);
            if (!group) group = getOrCreateTotalGroup(itemId);
            if (group) {
                const content = group.querySelector('.totalStreams.content');
                if (content) {
                    content.innerHTML = formattedText;
                    return true;
                }
            }
            // wait and retry
            await new Promise(r => setTimeout(r, 200));
        }
        console.warn('[Reviewer] Failed to inject total streams group for', itemId);
        return false;
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
            } else if (detailRibbon && detailRibbon.parentElement) {
                targetContainer = detailRibbon.parentElement;
                insertPosition = detailRibbon.nextSibling;
            } else if (detailWrapper) {
                targetContainer = detailWrapper;
                insertPosition = detailWrapper.firstChild;
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
            
            // Only show reviews for movies and TV shows (Series, Season, Episode)
            const allowedTypes = ['Movie', 'Series', 'Season', 'Episode'];
            if (!movieData || !allowedTypes.includes(movieData.Type)) {
                reviewerDiv.remove();
                return;
            }
            
            if (movieData && movieData.ProviderIds && movieData.ProviderIds.Imdb) {
                const imdbId = movieData.ProviderIds.Imdb;
                
                const reviews = await fetchImdbReview(imdbId);
                if (reviews && reviews.length > 0) {
                    
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
                    
                    const reviewsContainerDiv = document.createElement('div');
                    
                    reviews.forEach((review, index) => {
                        const reviewId = `${itemId}-${index}`;
                        
                        // Create review container with safe DOM methods
                        const reviewContainer = document.createElement('div');
                        reviewContainer.className = 'reviewContainer';
                        reviewContainer.style.cssText = 'margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #333;';
                        
                        // Create review details header
                        const reviewDetails = document.createElement('div');
                        reviewDetails.className = 'reviewDetails';
                        
                        const authorDiv = document.createElement('div');
                        authorDiv.style.cssText = 'margin-bottom: 4px; color: #aaa; font-size: 14px;';
                        authorDiv.textContent = 'by ';
                        const authorStrong = document.createElement('strong');
                        authorStrong.textContent = review.author || 'Anonymous';
                        authorDiv.appendChild(authorStrong);
                        
                        const ratingDiv = document.createElement('div');
                        ratingDiv.style.cssText = 'margin-bottom: 4px;';
                        const starSpan = document.createElement('span');
                        starSpan.className = 'material-icons starIcon star';
                        starSpan.setAttribute('aria-hidden', 'true');
                        ratingDiv.appendChild(starSpan);
                        if (review.rating) {
                            const ratingSpan = document.createElement('span');
                            ratingSpan.textContent = `${review.rating}/10`;
                            ratingDiv.appendChild(ratingSpan);
                        }
                        
                        reviewDetails.appendChild(authorDiv);
                        reviewDetails.appendChild(ratingDiv);
                        
                        // Create review content
                        const reviewContentContainer = document.createElement('div');
                        reviewContentContainer.id = `review-container-${reviewId}`;
                        reviewContentContainer.style.position = 'relative';
                        
                        const reviewTextDiv = document.createElement('div');
                        reviewTextDiv.className = 'reviewTextTruncated';
                        reviewTextDiv.id = `review-text-${reviewId}`;
                        reviewTextDiv.innerHTML = sanitizeAndFormatContent(review.content);
                        
                        const readMoreContainer = document.createElement('div');
                        readMoreContainer.className = 'readMoreContainer';
                        const readMoreBtn = document.createElement('button');
                        readMoreBtn.id = `review-toggle-${reviewId}`;
                        readMoreBtn.className = 'readMoreButton';
                        readMoreBtn.style.display = 'none';
                        readMoreBtn.textContent = 'Read more...';
                        readMoreContainer.appendChild(readMoreBtn);
                        
                        reviewContentContainer.appendChild(reviewTextDiv);
                        reviewContentContainer.appendChild(readMoreContainer);
                        
                        reviewContainer.appendChild(reviewDetails);
                        reviewContainer.appendChild(reviewContentContainer);
                        
                        reviewsContainerDiv.appendChild(reviewContainer);
                    });
                    
                    // Clear and rebuild the container safely
                    reviewerDiv.innerHTML = '';
                    const styleElement = document.createElement('style');
                    styleElement.textContent = cssStyles;
                    reviewerDiv.appendChild(styleElement);
                    
                    const sourceDiv = document.createElement('div');
                    sourceDiv.className = 'reviewsSource';
                    sourceDiv.innerHTML = `
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
                    `;
                    
                    reviewsContainerDiv.className = 'reviewsContainer';
                    
                    reviewerDiv.appendChild(sourceDiv);
                    reviewerDiv.appendChild(reviewsContainerDiv);
                    
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
                                    
                                    // Build modal content safely
                                    const modalContent = document.createElement('div');
                                    modalContent.className = 'reviewModalContent';
                                    
                                    const modalHeader = document.createElement('div');
                                    modalHeader.className = 'reviewModalHeader';
                                    
                                    const headerLeft = document.createElement('div');
                                    const authorStrong = document.createElement('strong');
                                    authorStrong.style.fontSize = '1.1em';
                                    authorStrong.textContent = review.author || 'Anonymous';
                                    headerLeft.appendChild(authorStrong);
                                    
                                    if (review.rating) {
                                        const ratingSpan = document.createElement('span');
                                        ratingSpan.style.marginLeft = '4px';
                                        ratingSpan.textContent = `${review.rating}/10`;
                                        headerLeft.appendChild(ratingSpan);
                                    }
                                    
                                    const closeBtn = document.createElement('button');
                                    closeBtn.className = 'reviewModalClose';
                                    closeBtn.title = 'Close';
                                    closeBtn.textContent = '×';
                                    
                                    modalHeader.appendChild(headerLeft);
                                    modalHeader.appendChild(closeBtn);
                                    
                                    const modalBody = document.createElement('div');
                                    modalBody.className = 'reviewModalBody';
                                    modalBody.innerHTML = sanitizeAndFormatContent(review.content);
                                    
                                    modalContent.appendChild(modalHeader);
                                    modalContent.appendChild(modalBody);
                                    modal.appendChild(modalContent);
                                    
                                    document.body.appendChild(modal);

                                    document.body.style.overflow = 'hidden';

                                    const closeModal = () => {
                                        modal.remove();
                                        document.body.style.overflow = '';
                                    };
                                    
                                    modal.addEventListener('click', (e) => {
                                        if (e.target === modal) closeModal();
                                    });
                                    
                                    closeBtn.addEventListener('click', closeModal);

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
        
        // Only show total streams for MusicAlbum
        if (!albumData || albumData.Type !== 'MusicAlbum') {
            return;
        }
        
        // Check if already processing this album
        if (processingAlbums.has(itemId)) {
            return;
        }
        
        // Check if already injected - remove all existing instances first
        const existingGroups = document.querySelectorAll('.detailsGroupItem.totalStreamsGroup');
        if (existingGroups.length > 0) {
            // If any of them match the current item ID, we're already done
            for (const group of existingGroups) {
                if (group.dataset.itemId === itemId) {
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
                return;
            }
            
            // Find target container - look for the genres group and insert after it
            const genresGroup = document.querySelector('.detailsGroupItem.genresGroup');
            if (!genresGroup) {
                return;
            }
            
            const parentContainer = genresGroup.parentElement;
            if (!parentContainer) {
                return;
            }
            
            // Ensure a total group exists (helper will insert before genresGroup)
            const totalStreamsGroup = getOrCreateTotalGroup(itemId);
            if (!totalStreamsGroup) {
                return;
            }

            // Check if we have cached total for this album
            if (albumTotalCache.has(itemId)) {
                const cachedTotal = albumTotalCache.get(itemId);
                const formattedTotal = cachedTotal.successCount > 0
                    ? `<span style="font-weight: 500; white-space: nowrap;">${escapeHtml(cachedTotal.totalStreams.toLocaleString())}</span>`
                    : `<span style="white-space: nowrap;">No stream data available</span>`;
                await updateTotalGroupWithRetry(itemId, formattedTotal);
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
                
                if (streamData && streamData.streamCount && streamData.streamCount !== 'N/A') {
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
            
            // Cache the album total
            albumTotalCache.set(itemId, { totalStreams, successCount });
            
            // Update the display
            const formattedTotal = successCount > 0 ? `<span style="font-weight: 500; white-space: nowrap;">${escapeHtml(totalStreams.toLocaleString())}</span>` : `<span style="white-space: nowrap;">No stream data available</span>`;
            // Update UI with retry to handle Jellyfin re-renders
            await updateTotalGroupWithRetry(itemId, formattedTotal);
            
        } catch (error) {
            console.error('[Reviewer] Error calculating total streams:', error);
        } finally {
            // Remove from processing set
            processingAlbums.delete(itemId);
        }
    }

    async function injectArtistTotalStreams() {
        const isDetailPage = window.location.hash.includes('/details?id=');
        if (!isDetailPage) return;

        const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
        const itemId = urlParams.get('id');
        if (!itemId) return;

        // Only run on MusicArtist pages
        const artistData = await getMovieData(itemId);
        if (!artistData || artistData.Type !== 'MusicArtist') {
            return;
        }

        // Avoid duplicate processing
        if (processingArtists.has(itemId)) return;

        // Remove any existing total streams groups (from previous views)
        const existingGroups = document.querySelectorAll('.detailsGroupItem.totalStreamsGroup');
        for (const g of existingGroups) {
            if (g.dataset.itemId === itemId) return;
            g.remove();
        }

        processingArtists.add(itemId);

        const apiClient = window.ApiClient;
        if (!apiClient) return;

        try {
            // Get all albums for this artist (query by AlbumArtistIds)
            const albumsResult = await apiClient.getItems(apiClient.getCurrentUserId(), {
                includeItemTypes: 'MusicAlbum',
                recursive: true,
                AlbumArtistIds: itemId,
                Limit: 100,
                StartIndex: 0
            });

            if (!albumsResult || !albumsResult.Items || albumsResult.Items.length === 0) {
                return;
            }

            // Prefer inserting into the same details groups container as albums (before genresGroup)
            let totalGroup = null;
            let targetContainer = null;
            let insertPosition = null;

            const genresGroup = document.querySelector('.detailsGroupItem.genresGroup');
            if (genresGroup && genresGroup.parentElement) {
                targetContainer = genresGroup.parentElement;
                insertPosition = genresGroup;
                totalGroup = document.createElement('div');
                totalGroup.className = 'detailsGroupItem totalStreamsGroup';
                totalGroup.dataset.itemId = itemId;
                totalGroup.innerHTML = `
                    <div class="totalStreamsLabel label">Total Streams</div>
                    <div class="totalStreams content">
                        <span style="font-size: 0.9em;">Calculating...</span>
                    </div>
                `;
                targetContainer.insertBefore(totalGroup, insertPosition);
            } else {
                // Fallback to previous insertion logic
                const castSection = document.querySelector('#castCollapsible');
                const detailWrapper = document.querySelector('.detailPageWrapperContainer');
                const detailPrimary = document.querySelector('.detailPagePrimaryContent');
                const detailRibbon = document.querySelector('.detailRibbon');

                if (castSection && castSection.parentElement) {
                    targetContainer = castSection.parentElement;
                    insertPosition = castSection;
                } else if (detailPrimary) {
                    targetContainer = detailPrimary;
                    insertPosition = detailPrimary.firstChild;
                } else if (detailRibbon && detailRibbon.parentElement) {
                    targetContainer = detailRibbon.parentElement;
                    insertPosition = detailRibbon.nextSibling;
                } else if (detailWrapper) {
                    targetContainer = detailWrapper;
                    insertPosition = detailWrapper.firstChild;
                } else {
                    const groupsContainer = document.querySelector('.detailsGroups');
                    if (groupsContainer) {
                        targetContainer = groupsContainer;
                        insertPosition = groupsContainer.firstChild;
                    }
                }

                totalGroup = document.createElement('div');
                totalGroup.className = 'detailsGroupItem totalStreamsGroup';
                totalGroup.dataset.itemId = itemId;
                totalGroup.innerHTML = `
                    <div class="totalStreamsLabel label">Total Streams</div>
                    <div class="totalStreams content">
                        <span style="font-size: 0.9em;">Calculating...</span>
                    </div>
                `;

                if (targetContainer && insertPosition) {
                    targetContainer.insertBefore(totalGroup, insertPosition);
                } else if (targetContainer) {
                    targetContainer.appendChild(totalGroup);
                }
            }

            let artistTotal = 0;
            let artistSuccessCount = 0;

            // For each album, use cached album totals if available, otherwise calculate
            const albumPromises = albumsResult.Items.map(async (album) => {
                if (!album || !album.Id) return 0;

                // Use cached album total if present
                if (albumTotalCache.has(album.Id)) {
                    const cached = albumTotalCache.get(album.Id);
                    if (cached && cached.successCount > 0) {
                        return cached.totalStreams;
                    }
                    return 0;
                }

                // Fetch tracks for the album and compute total similarly to injectAlbumTotalStreams
                try {
                    const tracksResult = await apiClient.getItems(apiClient.getCurrentUserId(), {
                        parentId: album.Id,
                        includeItemTypes: 'Audio',
                        sortBy: 'IndexNumber',
                        recursive: false
                    });

                    if (!tracksResult || !tracksResult.Items || tracksResult.Items.length === 0) {
                        // cache empty result to avoid re-query
                        albumTotalCache.set(album.Id, { totalStreams: 0, successCount: 0 });
                        return 0;
                    }

                    const trackPromises = tracksResult.Items.map(async (track) => {
                        const spotifyId = track.ProviderIds?.Spotify || null;
                        const trackName = track.Name || null;
                        const artistName = track.AlbumArtist || track.Artists?.[0] || null;

                        if (!spotifyId && (!trackName || !artistName)) return null;

                        const streamData = await fetchStreamCount(album.Id, track.Id, spotifyId, trackName, artistName);
                        if (streamData && streamData.streamCount && streamData.streamCount !== 'N/A') {
                            const count = parseInt(streamData.streamCount.replace(/,/g, ''), 10);
                            if (!isNaN(count)) return count;
                        }
                        return null;
                    });

                    const trackResults = await Promise.allSettled(trackPromises);
                    let albumTotal = 0;
                    let successCount = 0;
                    for (const r of trackResults) {
                        if (r.status === 'fulfilled' && r.value !== null) {
                            albumTotal += r.value;
                            successCount++;
                        }
                    }

                    albumTotalCache.set(album.Id, { totalStreams: albumTotal, successCount });
                    return albumTotal;
                } catch (e) {
                    console.error('[Reviewer] Error fetching tracks for album', album.Id, e);
                    return 0;
                }
            });

            const albumResults = await Promise.allSettled(albumPromises);
            for (const ar of albumResults) {
                if (ar.status === 'fulfilled' && typeof ar.value === 'number' && ar.value > 0) {
                    artistTotal += ar.value;
                    artistSuccessCount++;
                }
            }

            // Ensure the injected element is still in the DOM (Jellyfin may re-render)
            if (!totalGroup || !document.body.contains(totalGroup)) {
                const existing = document.querySelector(`.detailsGroupItem.totalStreamsGroup[data-item-id="${itemId}"]`);
                if (existing) {
                    totalGroup = existing;
                } else if (targetContainer && insertPosition) {
                    targetContainer.insertBefore(totalGroup, insertPosition);
                } else if (targetContainer) {
                    targetContainer.appendChild(totalGroup);
                } else {
                    // last ditch: insert into .detailsGroups if available
                    const groupsContainer = document.querySelector('.detailsGroups');
                    if (groupsContainer) groupsContainer.insertBefore(totalGroup, groupsContainer.firstChild);
                }
            }

            const formattedTotal = artistTotal > 0
                ? `<span style="font-weight: 500; white-space: nowrap;">${escapeHtml(artistTotal.toLocaleString())}</span>`
                : `<span style="white-space: nowrap;">No stream data available</span>`;

            // Use retry helper to inject/update the total group reliably
            await updateTotalGroupWithRetry(itemId, formattedTotal);

        } catch (error) {
            console.error('[Reviewer] Error calculating artist total streams:', error);
        } finally {
            processingArtists.delete(itemId);
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
        
        // Only show stream counts for Audio items (individual tracks), not albums or artists
        if (!musicData || musicData.Type !== 'Audio') {
            return;
        }
        
        // Get album ID and Spotify ID if available, otherwise use track/artist name
        const albumId = musicData.AlbumId || null;
        const spotifyId = musicData.ProviderIds?.Spotify || null;
        const trackName = musicData.Name || null;
        const artistName = musicData.AlbumArtist || musicData.Artists?.[0] || null;
        
        if (!spotifyId && (!trackName || !artistName)) {
            return;
        }
        
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
        setTimeout(injectArtistTotalStreams, 200);
        setTimeout(injectStreamCountIntoTrackList, 500);
    });
    
    window.addEventListener('hashchange', function() {
        setTimeout(injectOnMoviePage, 200);
        setTimeout(injectOnMusicPage, 200);
        setTimeout(injectAlbumTotalStreams, 200);
        setTimeout(injectArtistTotalStreams, 200);
        setTimeout(injectStreamCountIntoTrackList, 500);
    });
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            injectOnMoviePage();
            injectOnMusicPage();
            injectAlbumTotalStreams();
            injectArtistTotalStreams();
            setTimeout(injectStreamCountIntoTrackList, 500);
        });
    } else {
        setTimeout(injectOnMoviePage, 500);
        setTimeout(injectOnMusicPage, 500);
        setTimeout(injectAlbumTotalStreams, 500);
        setTimeout(injectArtistTotalStreams, 500);
        setTimeout(injectStreamCountIntoTrackList, 800);
    }
    
    window.addEventListener('load', function() {
        setTimeout(injectOnMoviePage, 500);
        setTimeout(injectOnMusicPage, 500);
        setTimeout(injectAlbumTotalStreams, 500);
        setTimeout(injectArtistTotalStreams, 500);
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
