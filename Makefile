.PHONY: help setup dev build clean logs sdk-build backend-install frontend-install

help:
	@echo "DANR - ANR Debugging Tool"
	@echo ""
	@echo "Available commands:"
	@echo "  make setup            - Initial project setup (install dependencies)"
	@echo "  make dev              - Start all services (backend, frontend, mongodb)"
	@echo "  make build            - Build all components"
	@echo "  make clean            - Stop and remove all containers and volumes"
	@echo "  make logs             - View logs from all services"
	@echo "  make sdk-build        - Build and publish Android SDK to local maven"
	@echo "  make backend-install  - Install backend dependencies"
	@echo "  make frontend-install - Install frontend dependencies"

setup: backend-install frontend-install
	@echo "✓ Setup complete! Run 'make dev' to start the services."

backend-install:
	@echo "Installing backend dependencies..."
	cd backend && npm install

frontend-install:
	@echo "Installing frontend dependencies..."
	cd frontend && npm install

dev:
	@echo "Starting all services..."
	docker-compose up

build:
	@echo "Building all services..."
	docker-compose build

clean:
	@echo "Cleaning up..."
	docker-compose down -v
	rm -rf backend/node_modules backend/dist
	rm -rf frontend/node_modules frontend/.next frontend/out

logs:
	docker-compose logs -f

sdk-build:
	@echo "Building Android SDK..."
	cd sdk && ./gradlew clean build publishToMavenLocal
	@echo "✓ SDK published to local Maven repository"
