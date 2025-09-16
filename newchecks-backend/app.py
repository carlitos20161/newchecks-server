import os
from flask import Flask
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore

# --- Flask app setup
app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev-secret-key")
CORS(app)  # allow React frontend

# --- Firebase Admin setup
cred = credentials.Certificate(
    os.path.join(os.path.dirname(__file__), "checks-6fc3e-firebase-adminsdk-fbsvc-fd8e9f9a34.json")
)
firebase_admin.initialize_app(cred)
firestore_db = firestore.client()

# --- Import routes
from routes import configure_routes
configure_routes(app, firestore_db)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5004, debug=True)
