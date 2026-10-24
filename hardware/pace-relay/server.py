"""PACE LAN relay: HTTP for M5, optional HTTPS for iPhone GPS."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, unquote
import argparse, json, math, ssl, threading, time, uuid

ROOT = Path(__file__).resolve().parents[2]
BOOT = uuid.uuid4().hex
state = {'sequence': 0, 'event': None}
lock = threading.Lock()
FILES = {'index.html', 'style.css', 'capture.css', 'capture.js', 'capture-core.js',
         'core.js', 'app.js', 'tiles.js', 'sw.js', 'icon.svg', 'manifest.webmanifest',
         'review.html', 'review.js', 'precision.js', 'document.css', 'guide.html', 'handout.html'}

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
        path = unquote(urlsplit(self.path).path).lstrip('/') or 'index.html'
        if path == 'api/last':
            with lock:
                payload = {**state, 'boot': BOOT, 'now': time.time()}
            return self.respond(200, payload)
        if path == 'lan-ca.cer':
            cert = Path(__file__).parent / '.local' / 'lan-ca.cer'
            if not cert.is_file(): return self.send_error(404)
            data = cert.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'application/x-x509-ca-cert')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        target = (ROOT / path).resolve()
        if not target.is_relative_to(ROOT) or not target.is_file(): return self.send_error(404)
        if path not in FILES and not (path.startswith(('vendor/', 'assets/')) and target.suffix in {'.js','.css','.png','.webp','.svg','.jpg'}):
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        # Avoid SimpleHTTPRequestHandler exposing non-allowlisted files via HEAD.
        self.send_error(405)

    def do_POST(self):
        if self.path != '/api/throw': return self.respond(404, {'error': 'not found'})
        self.connection.settimeout(3)
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 1 <= size <= 1024: raise ValueError('invalid body length')
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict) or data.get('event') != 'throw': raise ValueError('event must be throw')
            metrics = {}
            for key in ('accel_g', 'peak_g', 'motion_score', 'duration_ms'):
                if key in data:
                    value = data[key]
                    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not 0 <= value <= 100000:
                        raise ValueError('invalid '+key)
                    metrics[key] = value
            if 'peak_g' not in metrics:
                if 'accel_g' not in metrics: raise ValueError('missing peak_g')
                metrics['peak_g'] = metrics['accel_g']
            with lock:
                state['sequence'] += 1
                state['event'] = {**metrics, 'type':'throw', 'at':time.time()}
                sequence = state['sequence']
            return self.respond(200, {'ok':True,'sequence':sequence})
        except (ValueError, TypeError, TimeoutError) as exc:
            return self.respond(400, {'error':str(exc)})

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--https-port', type=int, default=8443)
    parser.add_argument('--cert')
    parser.add_argument('--key')
    args = parser.parse_args()
    http = ThreadingHTTPServer(('0.0.0.0',args.port),Handler)
    if args.cert and args.key:
        secure = ThreadingHTTPServer(('0.0.0.0',args.https_port),Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(args.cert,args.key)
        secure.socket = context.wrap_socket(secure.socket,server_side=True)
        threading.Thread(target=secure.serve_forever,daemon=True).start()
        print(f'iPhone GPS: https://YOUR_PC_IP:{args.https_port} (trust LAN CA first)',flush=True)
    print(f'M5: http://YOUR_PC_IP:{args.port}/api/throw',flush=True)
    print(f'Computer demo: http://localhost:{args.port}',flush=True)
    http.serve_forever()

if __name__ == '__main__': main()
