document.addEventListener('DOMContentLoaded', function() {
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('video-upload');
    const browseBtn = document.getElementById('browse-btn');
    const progressBar = document.querySelector('.progress-bar');
    const progressStatus = document.getElementById('progress-status');
    const uploadProgress = document.getElementById('upload-progress');
    const searchSection = document.getElementById('search-section');
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const resultsContainer = document.getElementById('results-container');
    const resultsList = document.getElementById('results-list');
    
    // Video player elements
    const videoPlayerContainer = document.getElementById('video-player-container');
    const videoPlayer = document.getElementById('video-player');
    const videoSource = document.getElementById('video-source');
    let currentVideoFilename = '';

    let segments = null; // Global variable for video transcript segments

    // Fetch segments when needed, returning a promise
    function fetchSegments() {
        return new Promise((resolve, reject) => {
            console.log("Fetching segments from backend...");
            fetch('/get_full_transcript')
                .then(response => {
                    console.log("Segments response:", response);
                    if (!response.ok) {
                        throw new Error('Failed to fetch segments: ' + response.statusText);
                    }
                    return response.json();
                })
                .then(data => {
                    console.log("Segments data received:", data);
                    if (data.transcript) {
                        segments = data.transcript.split('\n\n').map(line => {
                            const match = line.match(/\[(\d+:\d+)\s*-\s*(\d+:\d+)\]:\s*(.*)/);
                            if (match) {
                                return { start: match[1], end: match[2], text: match[3] };
                            }
                        }).filter(Boolean);
                        console.log("Parsed segments:", segments);
                        resolve(segments);
                    } else {
                        console.warn("No transcript in response");
                        segments = null;
                        resolve(null);
                    }
                })
                .catch(error => {
                    console.error("Failed to fetch segments:", error);
                    segments = null;
                    reject(error);
                });
        });
    }

    // Call fetchSegments on page load (optional, can remove if only fetching after upload)
    fetchSegments().catch(() => console.log("Initial segment fetch failed, will retry later"));

    // Handle file selection via browse button
    browseBtn.addEventListener('click', () => {
        fileInput.click();
    });

    // Handle file upload when a file is selected
    fileInput.addEventListener('change', handleFileUpload);

    // Drag and drop functionality
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('highlight');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('highlight');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('highlight');
        
        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            handleFileUpload();
        }
    });

    // Handle search button click
    searchBtn.addEventListener('click', performSearch);
    
    // Also search when Enter key is pressed
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    // Event delegation for jump buttons in search results
    resultsList.addEventListener('click', function(e) {
        const jumpBtn = e.target.closest('.jump-btn');
        if (jumpBtn) {
            const timeInSeconds = parseFloat(jumpBtn.dataset.time);
            videoPlayerContainer.classList.remove('d-none');
            videoPlayerContainer.scrollIntoView({ behavior: 'smooth' });
            videoPlayer.currentTime = timeInSeconds;
            videoPlayer.play();
        }
    });

    // Function to handle file upload
    function handleFileUpload() {
        const file = fileInput.files[0];
        if (!file) return;
        
        const fileType = file.type;
        if (!fileType.startsWith('video/')) {
            alert('Please upload a video file');
            return;
        }

        uploadArea.classList.add('d-none');
        uploadProgress.classList.remove('d-none');
        
        const formData = new FormData();
        formData.append('video', file);
        
        let progress = 0;
        const interval = setInterval(() => {
            progress += 5;
            if (progress <= 95) {
                progressBar.style.width = `${progress}%`;
                if (progress < 30) {
                    progressStatus.textContent = "Uploading video...";
                } else if (progress < 60) {
                    progressStatus.textContent = "Extracting audio...";
                } else {
                    progressStatus.textContent = "Transcribing content...";
                }
            }
        }, 500);

        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            clearInterval(interval);
            if (!response.ok) {
                throw new Error('Upload failed');
            }
            return response.json();
        })
        .then(data => {
            progressBar.style.width = '100%';
            progressStatus.textContent = "Processing complete!";
            
            currentVideoFilename = file.name;
            
            setTimeout(() => {
                uploadProgress.classList.add('d-none');
                searchSection.classList.remove('d-none');
                
                videoSource.src = `/video/${encodeURIComponent(currentVideoFilename)}`;
                videoPlayer.load();
                videoPlayerContainer.classList.remove('d-none');
                
                // Refetch segments after upload
                fetchSegments().catch(() => console.log("Segment fetch after upload failed"));
            }, 1000);
        })
        .catch(error => {
            clearInterval(interval);
            progressBar.classList.add('bg-danger');
            progressStatus.textContent = `Error: ${error.message}`;
            
            setTimeout(() => {
                uploadProgress.classList.add('d-none');
                uploadArea.classList.remove('d-none');
            }, 3000);
        });
    }

    // Function to perform search
    function performSearch() {
        const query = searchInput.value.trim();
        if (!query) {
            searchInput.classList.add('is-invalid');
            setTimeout(() => searchInput.classList.remove('is-invalid'), 3000);
            return;
        }

        searchBtn.disabled = true;
        searchBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Searching...';
        
        resultsList.innerHTML = '';
        const existingAnalysis = document.querySelector('.ai-analysis-container');
        if (existingAnalysis) {
            existingAnalysis.remove();
        }
        
        fetch('/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: query })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Search failed');
            }
            return response.json();
        })
        .then(results => {
            searchBtn.disabled = false;
            searchBtn.innerHTML = '<i class="fas fa-search me-2"></i>Search';
            
            resultsContainer.classList.remove('d-none');
            
            if (results.length === 0) {
                resultsList.innerHTML = '<div class="alert alert-info">No results found for your query. Try different keywords.</div>';
            } else {
                results.forEach(result => {
                    const resultItem = document.createElement('div');
                    resultItem.className = 'result-item';
                    resultItem.innerHTML = `
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <div>
                                <span class="timestamp">${result.start}</span>
                                <span class="timestamp">${result.end}</span>
                            </div>
                            <button class="btn btn-sm btn-outline-primary jump-btn" data-time="${convertTimeToSeconds(result.start)}">
                                <i class="fas fa-play me-1"></i>Jump to
                            </button>
                        </div>
                        <p class="mb-0">${highlightQuery(result.text, query)}</p>
                    `;
                    resultsList.appendChild(resultItem);
                });
                
                describeResults(query, results);
            }
        })
        .catch(error => {
            searchBtn.disabled = false;
            searchBtn.innerHTML = '<i class="fas fa-search me-2"></i>Search';
            
            resultsContainer.classList.remove('d-none');
            resultsList.innerHTML = `<div class="alert alert-danger">Error: ${error.message}</div>`;
        });
    }

    // Function to describe search results and handle follow-up questions
    function describeResults(query, results) {
        if (!results || results.length === 0) return;
        
        const aiContainer = document.createElement('div');
        aiContainer.className = 'ai-analysis-container mt-4';
        
        const describeBtn = document.createElement('button');
        describeBtn.className = 'btn btn-info';
        describeBtn.innerHTML = '<i class="fas fa-brain me-2"></i>Analyze These Results';
        
        aiContainer.appendChild(describeBtn);
        resultsList.parentNode.insertBefore(aiContainer, resultsList.nextSibling);
        
        describeBtn.addEventListener('click', async function() {
            console.log("Describe button clicked, ensuring segments are loaded");
            if (!segments) {
                console.warn("Segments not loaded yet, retrying...");
                try {
                    await fetchSegments();
                    if (!segments) {
                        alert("Could not load video transcript. Please try again.");
                        describeBtn.disabled = false;
                        describeBtn.innerHTML = '<i class="fas fa-brain me-2"></i>Analyze These Results';
                        return;
                    }
                } catch (error) {
                    console.error("Segment fetch failed in describeResults:", error);
                    alert("Failed to fetch transcript. Please try again.");
                    describeBtn.disabled = false;
                    describeBtn.innerHTML = '<i class="fas fa-brain me-2"></i>Analyze These Results';
                    return;
                }
            }
            showFollowUpForm(describeBtn, aiContainer);
        });
    }

    async function showFollowUpForm(describeBtn, aiContainer) {
        describeBtn.disabled = true;
        describeBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Analyzing...';
        
        if (!segments) {
            console.warn("Segments not loaded, fetching now...");
            try {
                await fetchSegments();
            } catch (error) {
                console.error("Segment fetch failed in showFollowUpForm:", error);
            }
        }
        
        const questionForm = document.createElement('div');
        questionForm.className = 'mt-3';
        questionForm.innerHTML = `
            <h5 class="mb-2"><i class="fas fa-question-circle me-2"></i>Ask Follow-up Questions</h5>
            <div class="input-group">
                <input type="text" class="form-control" id="follow-up-question" 
                       placeholder="Ask a question about this video...">
                <button class="btn btn-outline-primary" id="ask-btn">
                    <i class="fas fa-paper-plane me-1"></i>Ask
                </button>
            </div>
            <div id="answer-container" class="mt-3 d-none"></div>
        `;
        
        aiContainer.appendChild(questionForm);
        describeBtn.classList.add('d-none');
        
        setTimeout(() => {
            const askBtn = document.getElementById('ask-btn');
            const questionInput = document.getElementById('follow-up-question');
            
            if (askBtn && questionInput) {
                askBtn.addEventListener('click', askFollowUp);
                questionInput.addEventListener('keypress', e => {
                    if (e.key === 'Enter') {
                        console.log("Enter key pressed in follow-up question");
                        askFollowUp();
                    }
                });
            } else {
                console.error("Ask button or question input not found after delay");
            }
            describeBtn.disabled = false;
            describeBtn.innerHTML = '<i class="fas fa-brain me-2"></i>Analyze These Results';
        }, 100);
    }

    // Function to handle follow-up questions
    async function askFollowUp() {
        const questionInput = document.getElementById('follow-up-question');
        const question = questionInput.value.trim();
        const answerContainer = document.getElementById('answer-container');
        
        console.log("askFollowUp function called");
        
        if (!question) {
            console.log("No question provided, returning early");
            return;
        }
        
        console.log("Sending follow-up question:", question);
        
        // Show loading state
        const askBtn = document.getElementById('ask-btn');
        askBtn.disabled = true;
        askBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        
        if (!segments) {
            console.warn("Segments not loaded, fetching now...");
            try {
                await fetchSegments();
            } catch (error) {
                console.error("Segment fetch failed in askFollowUp:", error);
            }
        }
        
        let context = "No context available";
        if (segments && segments.length > 0) {
            context = "Video transcript segments:\n" + segments.map(seg => seg.text).join("\n");
            console.log("Context constructed:", context);
        } else {
            console.warn("Segments is still empty or undefined");
        }
        
        console.log("Preparing to send fetch request to /gpt2_ask");
        
        fetch('/gpt2_ask', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ question: question, context: context })
        })
        .then(response => {
            console.log("Fetch response received:", response);
            if (!response.ok) {
                throw new Error('Network response was not ok: ' + response.statusText);
            }
            return response.json();
        })
        .then(data => {
            console.log("Parsed data from server:", data);
            if (!data.answer) {
                throw new Error("No answer in response");
            }

            const newAnswerCard = document.createElement('div')
            newAnswerCard.className = 'card mb-2'
            newAnswerCard.style.backgroundColor = '#808080';
            newAnswerCard.innerHTML = `
                <div class="card-body">
                    <h6 class="card-subtitle mb-2 text-muted">Q: ${question}</h6>
                    <p class="card-text">${data.answer.replace(/\n/g, '<br>')}</p>
                </div>
            `;

           // Insert the new card at the beginning of the answer container
            if (answerContainer.firstChild) {
                answerContainer.insertBefore(newAnswerCard, answerContainer.firstChild);
            } else {
                answerContainer.appendChild(newAnswerCard); // If container is empty, append as first
            }
            answerContainer.classList.remove('d-none');
            
            questionInput.value = '';
            askBtn.disabled = false;
            askBtn.innerHTML = '<i class="fas fa-paper-plane me-1"></i>Ask';
        })

        .catch(error => {
            console.error('Error in fetch:', error);
            // Create an error card and append it
            const errorCard = document.createElement('div');
            errorCard.className = 'alert alert-danger mb-2';
            errorCard.style.backgroundColor = 'rgb(65, 65, 65)'; // Gray background for consistency
            errorCard.innerHTML = `Error getting answer. Please try again. Details: ${error.message}`;

            // Insert the error card at the beginning
            if (answerContainer.firstChild) {
                answerContainer.insertBefore(errorCard, answerContainer.firstChild);
            } else {
                answerContainer.appendChild(errorCard); // If container is empty, append as first
            }
            
            // answerContainer.appendChild(errorCard);
            answerContainer.classList.remove('d-none');
            askBtn.disabled = false;
            askBtn.innerHTML = '<i class="fas fa-paper-plane me-1"></i>Ask';
        });







            // // Set background color to light gray (#D3D3D3)
            // answerContainer.innerHTML = `
                // <div class="card" style="background-color: #D3D3D3;">
                //     <div class="card-body">
                //         <h6 class="card-subtitle mb-2 text-muted">Q: ${question}</h6>
                //         <p class="card-text">${data.answer.replace(/\n/g, '<br>')}</p>
                //     </div>
                // </div>
            // `;
            // answerContainer.classList.remove('d-none');
            
            // questionInput.value = '';
            // askBtn.disabled = false;
            // askBtn.innerHTML = '<i class="fas fa-paper-plane me-1"></i>Ask';
        // })
        // .catch(error => {
        //     console.error('Error in fetch:', error);
        //     // Set background color for error message too
        //     answerContainer.innerHTML = `
        //         <div class="alert alert-danger" style="background-color: #D3D3D3;">
        //             Error getting answer. Please try again. Details: ${error.message}
        //         </div>
        //     `;
        //     answerContainer.classList.remove('d-none');
        //     askBtn.disabled = false;
        //     askBtn.innerHTML = '<i class="fas fa-paper-plane me-1"></i>Ask';
        // });
    }

    // Helper function to highlight query terms in result text
    function highlightQuery(text, query) {
        const regex = new RegExp(`(${query})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    }

    // Helper function to convert MM:SS format to seconds
    function convertTimeToSeconds(timeString) {
        const [minutes, seconds] = timeString.split(':').map(Number);
        return minutes * 60 + seconds;
    }
});