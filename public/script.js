document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const moodCards = document.querySelectorAll('.mood-card');
    const loginPrompt = document.getElementById('login-prompt');
    const loginButton = document.getElementById('login-button');
    const resultsSection = document.getElementById('results');
    const selectedMoodSpan = document.getElementById('selected-mood');
    const songsTab = document.getElementById('songs-tab');
    const playlistsTab = document.getElementById('playlists-tab');
    const songsList = document.getElementById('songs-list');
    const playlistsList = document.getElementById('playlists-list');
    const tabButtons = document.querySelectorAll('.tab-button');
    const loader = document.querySelector('.loader');
    const visualizer = document.getElementById('visualizer');
    
    // Canvas setup for visualizer
    const ctx = visualizer.getContext('2d');
    visualizer.width = window.innerWidth;
    visualizer.height = window.innerHeight;
    
    // State
    let selectedMood = '';
    let isAuthenticated = false;
    let animationId;
    
    // Audio visualizer settings based on mood
    const visualizerSettings = {
        happy: { baseColor: '#1DB954', particles: 100, speed: 2, size: 5 },
        sad: { baseColor: '#4B6584', particles: 60, speed: 1, size: 3 },
        energetic: { baseColor: '#FF9F43', particles: 150, speed: 3, size: 4 },
        relaxed: { baseColor: '#54A0FF', particles: 50, speed: 0.8, size: 6 },
        angry: { baseColor: '#EE5253', particles: 120, speed: 2.5, size: 4 },
        focused: { baseColor: '#8854D0', particles: 80, speed: 1.2, size: 4 }
    };
    
    // Particles array for visualizer
    let particles = [];
    
    // Check if the user is authenticated
    const checkAuthentication = () => {
        if (window.location.hash === '#authenticated') {
            isAuthenticated = true;
            loginPrompt.classList.add('hidden');
            window.history.pushState("", document.title, window.location.pathname);
        } else if (window.location.hash === '#error=authentication_failed') {
            showAuthError();
            window.history.pushState("", document.title, window.location.pathname);
        }
    };
    
    // Show authentication error
    const showAuthError = () => {
        loginPrompt.innerHTML = `
            <p class="error-message">Authentication failed. Please try again.</p>
            <button id="login-button" class="spotify-button">
                <i class="fab fa-spotify"></i> Reconnect to Spotify
            </button>
        `;
        document.getElementById('login-button').addEventListener('click', () => {
            window.location.href = '/login';
        });
    };
    
    // Initialize particles for the visualizer
    const initParticles = (settings) => {
        particles = [];
        const { particles: count, baseColor } = settings;
        
        for (let i = 0; i < count; i++) {
            particles.push({
                x: Math.random() * visualizer.width,
                y: Math.random() * visualizer.height,
                radius: Math.random() * settings.size + 1,
                color: baseColor,
                speedX: (Math.random() - 0.5) * settings.speed,
                speedY: (Math.random() - 0.5) * settings.speed,
                opacity: Math.random() * 0.5 + 0.3
            });
        }
    };
    
    // Draw particles for the visualizer
    const drawParticles = () => {
        ctx.clearRect(0, 0, visualizer.width, visualizer.height);
        
        particles.forEach(particle => {
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
            ctx.fillStyle = `${particle.color}${Math.floor(particle.opacity * 255).toString(16).padStart(2, '0')}`;
            ctx.fill();
            
            // Update position
            particle.x += particle.speedX;
            particle.y += particle.speedY;
            
            // Wrap around edges
            if (particle.x < 0) particle.x = visualizer.width;
            if (particle.x > visualizer.width) particle.x = 0;
            if (particle.y < 0) particle.y = visualizer.height;
            if (particle.y > visualizer.height) particle.y = 0;
        });
        
        animationId = requestAnimationFrame(drawParticles);
    };
    
    // Update visualizer based on mood
    const updateVisualizer = (mood) => {
        if (animationId) {
            cancelAnimationFrame(animationId);
        }
        
        const settings = visualizerSettings[mood] || visualizerSettings.happy;
        initParticles(settings);
        drawParticles();
    };
    
    // Handle window resize
    window.addEventListener('resize', () => {
        visualizer.width = window.innerWidth;
        visualizer.height = window.innerHeight;
        
        if (selectedMood) {
            updateVisualizer(selectedMood);
        }
    });
    
    // Initialize
    checkAuthentication();
    
    // Start with a default visualizer
    updateVisualizer('happy');
    
    // Event Listeners
    loginButton.addEventListener('click', () => {
        window.location.href = '/login';
    });
    
    moodCards.forEach(card => {
        card.addEventListener('click', () => {
            // Reset all cards
            moodCards.forEach(c => c.classList.remove('selected'));
            
            // Select the clicked card
            card.classList.add('selected');
            
            // Update selected mood
            selectedMood = card.dataset.mood;
            selectedMoodSpan.textContent = selectedMood;
            
            // Update visualizer
            updateVisualizer(selectedMood);
            
            // Show results if authenticated, otherwise show login prompt
            if (isAuthenticated) {
                loginPrompt.classList.add('hidden');
                resultsSection.classList.remove('hidden');
                fetchRecommendations(selectedMood);
            } else {
                loginPrompt.classList.remove('hidden');
                resultsSection.classList.add('hidden');
            }
        });
    });
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Update active tab button
            tabButtons.forEach(b => b.classList.remove('active'));
            button.classList.add('active');
            
            // Show relevant content
            const tabName = button.dataset.tab;
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(`${tabName}-tab`).classList.add('active');
        });
    });
    
    // Functions to fetch data
    async function fetchRecommendations(mood) {
        try {
            // Show loader
            loader.classList.remove('hidden');
            songsList.innerHTML = '';
            playlistsList.innerHTML = '';
            
            // Fetch recommended songs with retry mechanism
            let songsData = null;
            try {
                const songsResponse = await fetch(`/recommendations/${mood}`);
                if (!songsResponse.ok) {
                    throw new Error(`HTTP error! Status: ${songsResponse.status}`);
                }
                songsData = await songsResponse.json();
            } catch (error) {
                console.error('Error fetching recommendations:', error);
                // Fallback to a second attempt with a slight delay
                await new Promise(resolve => setTimeout(resolve, 1000));
                try {
                    const songsRetryResponse = await fetch(`/recommendations/${mood}`);
                    songsData = await songsRetryResponse.json();
                } catch (retryError) {
                    console.error('Retry failed:', retryError);
                    songsList.innerHTML = `
                        <div class="error-message">
                            <i class="fas fa-exclamation-circle"></i>
                            <p>Failed to load recommendations. Please try again.</p>
                        </div>
                    `;
                }
            }
            
            // Fetch playlists with retry mechanism
            let playlistsData = null;
            try {
                const playlistsResponse = await fetch(`/playlists/${mood}`);
                if (!playlistsResponse.ok) {
                    throw new Error(`HTTP error! Status: ${playlistsResponse.status}`);
                }
                playlistsData = await playlistsResponse.json();
            } catch (error) {
                console.error('Error fetching playlists:', error);
                // Fallback to a second attempt
                await new Promise(resolve => setTimeout(resolve, 1000));
                try {
                    const playlistsRetryResponse = await fetch(`/playlists/${mood}`);
                    playlistsData = await playlistsRetryResponse.json();
                } catch (retryError) {
                    console.error('Retry failed:', retryError);
                    playlistsList.innerHTML = `
                        <div class="error-message">
                            <i class="fas fa-exclamation-circle"></i>
                            <p>Failed to load playlists. Please try again.</p>
                        </div>
                    `;
                }
            }
            
            // Render songs if data exists
            if (songsData && songsData.tracks) {
                renderSongs(songsData.tracks);
            }
            
            // Render playlists if data exists
            if (playlistsData && playlistsData.playlists && playlistsData.playlists.items) {
                renderPlaylists(playlistsData.playlists.items);
            }
            
            // Hide loader
            loader.classList.add('hidden');
        } catch (error) {
            console.error('Fatal error in fetch process:', error);
            loader.classList.add('hidden');
            
            // Show generic error message
            songsList.innerHTML = playlistsList.innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Something went wrong. Please try again later.</p>
                </div>
            `;
        }
    }
    
    function renderSongs(songs) {
        songsList.innerHTML = '';
        
        if (!songs || songs.length === 0) {
            songsList.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-music"></i>
                    <p>No songs found for this mood. Try another one!</p>
                </div>
            `;
            return;
        }
        
        songs.forEach(song => {
            const songCard = document.createElement('div');
            songCard.className = 'music-card';
            
            // Find best available image
            const imageUrl = song.album.images && song.album.images.length > 0 
                ? song.album.images[0].url 
                : '/placeholder.jpg';
                
            const artists = song.artists.map(artist => artist.name).join(', ');
            
            // Create preview button if available
            const previewButton = song.preview_url 
                ? `<button class="preview-button" data-preview="${song.preview_url}">
                     <i class="fas fa-play"></i>
                   </button>` 
                : '';
            
            songCard.innerHTML = `
                <img src="${imageUrl}" alt="${song.name}" class="music-card-image">
                <div class="music-card-content">
                    <div class="music-card-title">${song.name}</div>
                    <div class="music-card-artists">${artists}</div>
                    <a href="${song.external_urls.spotify}" target="_blank" class="music-card-button">
                        <i class="fab fa-spotify"></i> Play on Spotify
                    </a>
                    ${previewButton}
                </div>
            `;
            
            songsList.appendChild(songCard);
        });
        
        // Add event listeners for preview buttons
        document.querySelectorAll('.preview-button').forEach(button => {
            button.addEventListener('click', () => {
                const previewUrl = button.dataset.preview;
                // Play audio preview
                if (previewUrl) {
                    const audio = new Audio(previewUrl);
                    audio.play();
                    
                    // Change button to pause
                    button.innerHTML = '<i class="fas fa-pause"></i>';
                    
                    // Reset button after preview ends
                    audio.onended = () => {
                        button.innerHTML = '<i class="fas fa-play"></i>';
                    };
                }
            });
        });
    }
    
    function renderPlaylists(playlists) {
        playlistsList.innerHTML = '';
    
        // Validate `playlists` is actually an array
        if (!Array.isArray(playlists) || playlists.length === 0) {
            playlistsList.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-list"></i>
                    <p>No playlists found for this mood. Try another one!</p>
                </div>
            `;
            return;
        }
    
        playlists.forEach((playlist) => {
            // Ensure playlist object exists
            if (!playlist) {
                console.warn('Encountered a null/undefined playlist object, skipping...');
                return;
            }
    
            // Safely handle images array
            const imageUrl =
                playlist.images && playlist.images.length > 0
                    ? playlist.images[0].url
                    : '/placeholder.jpg';
    
            const ownerName =
                playlist.owner && playlist.owner.display_name
                    ? playlist.owner.display_name
                    : 'Unknown';
    
            const playlistCard = document.createElement('div');
            playlistCard.className = 'music-card';
    
            playlistCard.innerHTML = `
                <img src="${imageUrl}" alt="${playlist.name || 'Playlist'}" class="music-card-image">
                <div class="music-card-content">
                    <div class="music-card-title">${playlist.name || 'Untitled Playlist'}</div>
                    <div class="music-card-artists">By: ${ownerName}</div>
                    <a href="${playlist.external_urls?.spotify || '#'}" 
                        target="_blank" 
                        class="music-card-button">
                        <i class="fab fa-spotify"></i> Open on Spotify
                    </a>
                </div>
            `;
    
            playlistsList.appendChild(playlistCard);
        });
    }    
})