import os
import whisper
import ffmpeg
import numpy as np
from flask import Flask, render_template, request, jsonify, send_from_directory
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import ssl
from gpt_service import GPTService

# Fix SSL issue for downloading models
ssl._create_default_https_context = ssl._create_unverified_context

# Global variables
ids = None
embedding_matrix = None
segments = None
current_video_path = None

# Initialize Flask app
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500 MB max upload

# Load models
print("Loading AI models...")
whisper_model = whisper.load_model("small")
embd_model = SentenceTransformer("all-MiniLM-L6-v2")
print("Models loaded successfully!")

# Ensure uploads directory exists
os.makedirs("uploads", exist_ok=True)

def transcribe_video(video_path, audio_path="temp_audio.mp3"):
    """Extracts audio from video and transcribes it using Whisper."""
    try:
        print(f"Extracting audio from {video_path}...")
        ffmpeg.input(video_path).output(
            audio_path, 
            format="mp3", 
            acodec="libmp3lame", 
            ar="16k"
        ).run(overwrite_output=True, quiet=True)
        
        print("Transcribing audio...")
        result = whisper_model.transcribe(audio_path, word_timestamps=True)
        print("Transcription complete!")
        return result
    except Exception as e:
        print(f"Error in transcription: {e}")
        return None

def extract_segments(data):
    """Extracts and formats transcription segments."""
    if not data or "segments" not in data:
        return {}
    
    return {
        segment['id']: {
            'start': segment['start'], 
            'end': segment['end'], 
            'text': segment['text']
        }
        for segment in data.get('segments', [])
    }

def create_embeddings(segments_dict):
    """Generates embeddings for each transcript segment."""
    print(f"Creating embeddings for {len(segments_dict)} segments...")
    ids = list(segments_dict.keys())
    texts = [segments_dict[seg_id]['text'] for seg_id in ids]

    embeddings = embd_model.encode(texts, batch_size=32, show_progress_bar=True)
    print("Embeddings created successfully!")
    
    return np.array(ids), np.array(embeddings)

def search_similar_segments(user_text, segments_dict, ids, embedding_matrix, top_k=5):
    """Finds top-k most similar transcript segments based on cosine similarity."""
    user_embedding = embd_model.encode(user_text).reshape(1, -1)
    similarities = cosine_similarity(user_embedding, embedding_matrix)[0]
    top_indices = np.argsort(similarities)[::-1][:top_k]

    return [
        {
            "text": segments_dict[ids[idx]]['text'], 
            "start": format_time(segments_dict[ids[idx]]['start']), 
            "end": format_time(segments_dict[ids[idx]]['end']),
            "score": float(similarities[idx])
        }
        for idx in top_indices
    ]

def format_time(seconds):
    # Converts seconds into MM:SS format.
    minutes, remaining_seconds = divmod(int(seconds), 60)
    return f"{minutes}:{remaining_seconds:02d}"

@app.route("/")
def index():
    # Renders the homepage.
    return render_template("index.html")

@app.route("/upload", methods=["POST"])
def upload():
    """Handles video file upload and transcription."""
    global ids, embedding_matrix, segments, current_video_path

    if 'video' not in request.files:
        return jsonify({"error": "No video file in request"}), 400
        
    video_file = request.files.get("video")
    if not video_file or video_file.filename == '':
        return jsonify({"error": "No video file selected"}), 400

    video_filename = video_file.filename
    video_path = os.path.join("uploads", video_filename)
    video_file.save(video_path)
    current_video_path = video_path

    print(f"Video file '{video_filename}' has been uploaded successfully")

    try:
        transcription = transcribe_video(video_path)
        if transcription is None:
            return jsonify({"error": "Transcription failed"}), 500

        segments = extract_segments(transcription)
        if not segments:
            return jsonify({"error": "No segments found in transcription"}), 500

        ids, embedding_matrix = create_embeddings(segments)

        return jsonify({
            "message": "Transcription completed", 
            "segments_count": len(segments),
            "video_filename": video_filename,
            "duration": format_time(transcription.get("duration", 0))
        })
    except Exception as e:
        print(f"Error during processing: {e}")
        return jsonify({"error": f"Processing failed: {str(e)}"}), 500

@app.route("/search", methods=["POST"])
def search():
    """Handles searching for similar segments."""
    global ids, embedding_matrix, segments

    if segments is None or ids is None or embedding_matrix is None:
        return jsonify({"error": "No transcription data available. Please upload a video first."}), 400

    data = request.get_json()
    if not data or "query" not in data:
        return jsonify({"error": "No query provided"}), 400
        
    query = data.get("query", "").strip()
    if not query:
        return jsonify({"error": "Query cannot be empty"}), 400

    try:
        results = search_similar_segments(query, segments, ids, embedding_matrix)
        return jsonify(results)
    except Exception as e:
        print(f"Error during search: {e}")
        return jsonify({"error": f"Search failed: {str(e)}"}), 500

@app.route('/video/<filename>')
def serve_video(filename):
    """Serves the video file for playback."""
    return send_from_directory('uploads', filename)

@app.route('/status')
def get_status():
    """Returns current processing status."""
    global segments
    
    if segments is None:
        return jsonify({"status": "ready", "has_transcription": False})
    else:
        return jsonify({
            "status": "ready",
            "has_transcription": True,
            "segments_count": len(segments)
        })

@app.route('/get_full_transcript')
def get_full_transcript():
    """Returns the full transcript for download."""
    global segments
    
    if segments is None:
        return jsonify({"error": "No transcript available"}), 400
        
    full_transcript = ""
    for segment_id in sorted(segments.keys()):
        segment = segments[segment_id]
        time_str = f"[{format_time(segment['start'])} - {format_time(segment['end'])}]"
        full_transcript += f"{time_str} {segment['text']}\n\n"
    
    return jsonify({"transcript": full_transcript})

@app.route("/describe", methods=["POST"])
def describe_results():
    global segments
    
    if segments is None:
        return jsonify({"error": "No video has been processed yet"}), 400
        
    data = request.get_json()
    search_results = data.get("results", [])
    query = data.get("query", "")
    
    if not search_results:
        return jsonify({"error": "No search results provided"}), 400
    
    context = "The following segments were found in the video:\n"
    for i, result in enumerate(search_results):
        context += f"{i+1}. [{result['start']} - {result['end']}]: {result['text']}\n"
    
    prompt = f"Based on these video segments about '{query}', provide a concise summary and analysis."
    try:
        gpt_response = GPTService.get_ai_response(prompt, context)
        return jsonify({"description": gpt_response})
    except Exception as e:
        return jsonify({"error": f"Error generating analysis: {str(e)}"}), 500

@app.route("/gpt2_ask", methods=["POST"])
def gpt2_ask():
    global segments
    
    if segments is None:
        return jsonify({"error": "No video has been processed yet"}), 400
        
    data = request.get_json()
    question = data.get("question", "")
    context = data.get("context", "")

    print(f"Received question: {question}")
    print(f"Received context: {context}")
    
    if not question:
        return jsonify({"error": "No question provided"}), 400
    
    # Preprocess context to limit length
    if context.startswith("Video transcript segments:"):
        context = context[:500] + "..." if len(context) > 500 else context
    
    try:
        gpt_response = GPTService.get_ai_response(question)
        print(f"GPT-2 response: {gpt_response}")
        return jsonify({"answer": gpt_response})
    except Exception as e:
        print(f"Error during GPT-2 response generation: {e}")
        return jsonify({"error": f"Failed to generate response: {str(e)}"}), 500

@app.errorhandler(413)
def request_entity_too_large(error):
    """Handles file too large error."""
    return jsonify({"error": "File too large. Maximum allowed size is 500MB"}), 413

@app.errorhandler(500)
def server_error(error):
    """Handles server errors."""
    return jsonify({"error": "Server error. Please try again later."}), 500

@app.errorhandler(404)
def not_found(error):
    """Handles 404 errors."""
    return jsonify({"error": "Resource not found"}), 404

if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0')
