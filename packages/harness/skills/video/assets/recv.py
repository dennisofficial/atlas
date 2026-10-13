import http.server, pathlib, socketserver, sys

out = pathlib.Path(sys.argv[1])

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers['content-length']))
        out.mkdir(parents=True, exist_ok=True)
        (out / f"{int(float(self.headers['x-ts']) * 1000):020d}.jpg").write_bytes(body)
        self.send_response(200)
        self.send_header('content-length', '0')
        self.end_headers()
    def log_message(self, *args):
        pass

class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

Server(('127.0.0.1', int(sys.argv[2])), Handler).serve_forever()
