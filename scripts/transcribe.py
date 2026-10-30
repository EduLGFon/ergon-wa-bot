import sys, json, subprocess
import numpy as np
from faster_whisper import WhisperModel

audio_path = sys.argv[1]
lang = sys.argv[2] if len(sys.argv) > 2 else 'pt'
model_size = sys.argv[3] if len(sys.argv) > 3 else 'medium'
compute_type = sys.argv[4] if len(sys.argv) > 4 else 'int8'

# Decode any input to 16kHz mono PCM via ffmpeg (avoids PyAV version issues)
proc = subprocess.run(
    ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', audio_path,
     '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-'],
    stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
)
audio = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0

model = WhisperModel(model_size, device='cpu', compute_type=compute_type)
segments, info = model.transcribe(
    audio,
    language=lang.split('-')[0],
    beam_size=5,
    vad_filter=True,
    condition_on_previous_text=True,
)
text = ' '.join(s.text for s in segments).strip()
print(json.dumps({'text': text, 'language': info.language, 'duration': info.duration}))