import firebase_admin
from firebase_admin import credentials, firestore

# Path to your downloaded service account key JSON
cred = credentials.Certificate("checks-6fc3e-firebase-adminsdk-fbsvc-fd8e9f9a34.json")

# Initialize the Firebase app with that credential
firebase_admin.initialize_app(cred)

# Now you can access Firestore
db = firestore.client()

# Example: get all employees
employees_ref = db.collection('employees')
docs = employees_ref.stream()

for doc in docs:
    print(f"{doc.id} => {doc.to_dict()}")
