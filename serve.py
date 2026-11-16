#!/usr/bin/env python3
"""
Calibre-Web PWA - Serveur de test local
Permet d'ouvrir la PWA sur PC et directement sur smartphone Android connecté au même réseau Wi-Fi.
"""

import http.server
import socket
import socketserver
import os
import mimetypes

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# Configure MIME types for PWA and WASM
mimetypes.add_type('application/wasm', '.wasm')
mimetypes.add_type('application/manifest+json', '.webmanifest')
mimetypes.add_type('application/x-sqlite3', '.db')
mimetypes.add_type('application/epub+zip', '.epub')

class PWAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Enable caching headers and allow local access
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

if __name__ == '__main__':
    local_ip = get_local_ip()
    print("=" * 65)
    print(" 📚 CALIBRE-WEB PWA - SERVEUR LOCAL POUR SMARTPHONE ANDROID")
    print("=" * 65)
    print(f" Répertoire servi : {DIRECTORY}")
    print(f" Accès sur ce PC : http://localhost:{PORT}")
    print(f" Accès sur Smartphone Android (Wi-Fi) : http://{local_ip}:{PORT}")
    print("=" * 65)
    print(" Pour installer la PWA sur Android :")
    print(" 1. Ouvrez Chrome sur votre smartphone à l'adresse ci-dessus.")
    print(" 2. Appuyez sur le menu (⋮) puis 'Ajouter à l'écran d'accueil'")
    print("    ou cliquez sur le bouton 'Installer' dans la barre.")
    print("=" * 65)
    print("Appuyez sur Ctrl+C pour arrêter le serveur.\n")

    with socketserver.TCPServer(("", PORT), PWAHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nArrêt du serveur.")
