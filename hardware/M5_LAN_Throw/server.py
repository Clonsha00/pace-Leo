from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json, threading, time, math
ROOT = Path(__file__).resolve().parent
state = {'sequence': 0, 'event': None}
lock = threading.Lock()

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def respond(self, code, data):
        payload = json.dumps(data, ensure_ascii=False, allow_nan=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
    def do_GET(self):
        if self.path.split('?')[0] == '/api/last':
            with lock: payload = dict(state)
            return self.respond(200, payload)
        if self.path == '/': self.path='/index.html'
        return super().do_GET()
    def do_POST(self):
        if self.path != '/api/throw': return self.respond(404, {'error': 'not found'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length < 1 or length > 1024: raise ValueError('invalid body length')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict) or data.get('event') != 'throw': raise ValueError('event must be throw')
            metrics = {}
            for key in ('accel_g', 'peak_g', 'motion_score', 'duration_ms'):
                if key in data:
                    v = data[key]
                    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 or v > 100000:
                        raise ValueError('invalid '+key)
                    metrics[key] = v
            if 'peak_g' not in metrics and 'accel_g' in metrics: metrics['peak_g'] = metrics['accel_g']
            metrics['type'] = 'throw'
            metrics['at'] = time.time()
            with lock:
                state['sequence'] += 1
                state['event'] = metrics
                seq = state['sequence']
            print(f'THROW #{seq} peak={metrics.get("peak_g")} score={metrics.get("motion_score")}', flush=True)
            return self.respond(200, {'ok':True,'sequence':seq})
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            return self.respond(400, {'error':str(exc)})

if __name__ == '__main__':
    print('PACE M5 LAN v2 at http://0.0.0.0:8765', flush=True)
    ThreadingHTTPServer(('0.0.0.0',8765),Handler).serve_forever()
