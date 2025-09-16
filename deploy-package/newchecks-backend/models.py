from extensions import db

# ✅ Example model, replace or expand as needed
class Example(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100))
