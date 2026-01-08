export default function() {
    console.log('🎬 Reviewer web plugin loaded!');
    
    // Function to create and inject the featured div
    function createFeaturedDiv() {
        // Don't inject if already exists
        if (document.getElementById('Reviewer-div')) {
            return;
        }
        
        // Only inject on home pages
        const pathname = window.location.pathname;
        if (!pathname.includes('home') && pathname !== '/' && pathname !== '/web/' && pathname !== '/web/index.html') {
            return;
        }
        
        console.log('🎬 Reviewer: Attempting to inject featured div');
        
        // Find a suitable container
        const containers = [
            '.homePage',
            '.homePageContent',
            '.view.pageContainer',
            '[data-role="main"]',
            '.scrollY',
            '.pageContainer',
            '.sections',
            'main',
            'body'
        ];
        
        let targetContainer = null;
        for (const selector of containers) {
            targetContainer = document.querySelector(selector);
            if (targetContainer) {
                console.log('🎬 Reviewer: Found container:', selector);
                break;
            }
        }
        
        if (targetContainer) {
            // Create the featured content div
            const featuredDiv = document.createElement('div');
            featuredDiv.id = 'Reviewer-div';
            featuredDiv.style.cssText = `
                width: 100%;
                height: 200px;
                background: linear-gradient(135deg, #1e3a8a, #3b82f6);
                margin: 20px 0;
                border-radius: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 24px;
                font-weight: bold;
                position: relative;
                z-index: 1000;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(255, 255, 255, 0.1);
            `;
            featuredDiv.innerHTML = '🎬 Reviewer - Featured Content Coming Soon! 🎬';
            
            // Insert at the beginning of the container
            if (targetContainer.firstChild) {
                targetContainer.insertBefore(featuredDiv, targetContainer.firstChild);
            } else {
                targetContainer.appendChild(featuredDiv);
            }
            
            console.log('✅ Reviewer: Successfully injected featured div!');
        } else {
            console.log('❌ Reviewer: No suitable container found');
        }
    }
    
    // Try injection multiple times with different strategies
    function attemptInjection() {
        createFeaturedDiv();
        setTimeout(createFeaturedDiv, 100);
        setTimeout(createFeaturedDiv, 500);
        setTimeout(createFeaturedDiv, 1000);
        setTimeout(createFeaturedDiv, 2000);
    }
    
    // Initial injection
    attemptInjection();
    
    // Listen for DOM changes (SPA navigation)
    const observer = new MutationObserver(() => {
        setTimeout(createFeaturedDiv, 200);
    });
    
    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    // Listen for navigation events
    let lastUrl = location.href;
    function checkUrlChange() {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            console.log('🎬 Reviewer: URL changed to', lastUrl);
            setTimeout(attemptInjection, 100);
        }
    }
    
    setInterval(checkUrlChange, 1000);
    
    console.log('🎬 Reviewer: Web plugin initialization complete');
}