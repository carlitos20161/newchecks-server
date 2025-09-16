FROM python:3.9-slim

# Set working directory
WORKDIR /app

# Copy requirements
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Copy source code
COPY . .

# Expose port
EXPOSE 5004

# Start the app
CMD ["python", "app.py"]
