import sys, json, subprocess, os
import numpy as np
from faster_whisper import WhisperModel

def decode(audio_path):
    af = 'silenceremove=start_periods=1:start_silence=0.3:start_threshold=-40dB'
    if os.environ.get('TRANSCRYPT_DENOISE') == '1':
        af = 'afftdn=nf=-25,' + af
    proc = subprocess.run(
        ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', audio_path,
         '-af', af, '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-'],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    )
    return np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0

_model_cache = {}

def get_model(model_size, compute_type):
    key = (model_size, compute_type)
    if key not in _model_cache:
        _model_cache[key] = WhisperModel(model_size, device='cpu', compute_type=compute_type)
    return _model_cache[key]

def run_one(audio_path, lang, model_size, compute_type):
    audio = decode(audio_path)
    model = get_model(model_size, compute_type)
    segments, info = model.transcribe(
        audio,
        language=lang.split('-')[0],
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=True,
    )
    text = ' '.join(s.text for s in segments).strip()
    return {'text': text, 'language': info.language, 'duration': info.duration}

def one_shot():
    audio_path = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 else 'pt'
    model_size = sys.argv[3] if len(sys.argv) > 3 else 'medium'
    compute_type = sys.argv[4] if len(sys.argv) > 4 else 'int8'
    try:
        res = run_one(audio_path, lang, model_size, compute_type)
        print(json.dumps(res), flush=True)
    except Exception as e:
        print(json.dumps({'error': str(e)}), flush=True)
        sys.exit(1)

def daemon():
    # Long-lived: load model once, process requests from stdin.
    # Each request line: audio_path<TAB>lang<TAB>model<TAB>compute_type
    # Each response line: JSON
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        parts = line.split('\t')
        audio_path = parts[0]
        lang = parts[1] if len(parts) > 1 else 'pt'
        model_size = parts[2] if len(parts) > 2 else 'medium'
        compute_type = parts[3] if len(parts) > 3 else 'int8'
        try:
            res = run_one(audio_path, lang, model_size, compute_type)
            print(json.dumps(res), flush=True)
        except Exception as e:
            print(json.dumps({'error': str(e)}), flush=True)

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--daemon':
        daemon()
    else:
        one_shot()
