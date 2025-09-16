from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate

# initialize db and migrate so they can be imported elsewhere
db = SQLAlchemy()
migrate = Migrate()
