# Flood-Aware Navigation and Disaster Management System

## Overview

This project is a data-driven flood navigation and disaster management platform designed to assist users during flood events. It integrates real-time weather data, terrain analysis, and intelligent routing to guide users to safe locations while also estimating disaster impact and improving public awareness through an interactive simulation module.

The system focuses on transforming raw environmental data into actionable insights and decisions, enabling safer navigation and better emergency response.

---
## How to run
1. **Clone the Repository**
git clone <your-repository-url>
cd <your-project-folder>
2. **Create Virtual Environment (recommended)**
python -m venv venv

Activate it:
Windows
venv\Scripts\activate

Mac/Linux
source venv/bin/activate
3. Install Dependencies
pip install -r requirements.txt

**4. Configure Environment Variables**

Create a .env file in the root directory and add your API keys:
WEATHER_API_KEY=your_api_key_here
GEMINI_API_KEY=your_api_key_here

**5. Run the Backend Server**python app.py


## Key Features

### Flood Risk Assessment

* Computes flood risk using rainfall intensity, accumulation, and terrain elevation
* Classifies risk into safe, moderate, and high levels
* Provides predictive insights based on forecast data

### Smart Navigation System

* Generates optimal routes using a weighted pathfinding algorithm (A* / Dijkstra)
* Avoids flood-prone and low-elevation areas
* Automatically reroutes users to the nearest safe shelter within a defined radius
* Incorporates safety scoring instead of shortest distance only

### Shelter Management

* Maintains structured shelter data including location, capacity, and status
* Selects the best shelter based on distance, elevation, and availability
* Tracks occupancy and prevents overcrowding through dynamic updates

### Disaster Impact Estimation

* Estimates affected population using population density and risk factors
* Calculates potential property damage using simplified damage functions
* Provides risk-based outputs such as low, moderate, and high impact zones

### Weather Intelligence Dashboard

* Displays current weather conditions and short-term forecasts
* Visualizes rainfall trends and future risk windows
* Generates actionable alerts and recommendations for users

### Simulation Module

* Interactive 2D map-based simulation
* Users navigate through a virtual environment and encounter flood scenarios
* Decision-based outcomes that educate users on safe practices

### Alert and Notification System

* Generates real-time alerts based on weather and risk thresholds
* Integrates local disaster updates to enhance situational awareness

---

## System Architecture

* Data Ingestion Layer
* Processing and Risk Engine
* Location and Mapping Layer
* Shelter Management Module
* Smart Navigation Engine
* Weather Intelligence Interface
* Simulation Module
* Alert and Notification System
* Frontend Layer
* Backend Layer

---

## Data Sources

* Weather data from Open-Meteo and IMD references
* Terrain elevation from satellite-derived datasets (DEM)
* Road network and map data from OpenStreetMap
* Population estimates from public datasets such as WorldPop
* Shelter data (mock or structured dataset for demonstration)

---

## Technology Stack

### Frontend

* HTML, CSS, JavaScript
* Leaflet for map visualization
* Charting library for forecast visualization

### Backend

* Node.js or Python (FastAPI)
* REST APIs for data handling and routing

### Algorithms and Models

* A* or Dijkstra for routing
* Haversine formula for distance calculation
* Rule-based flood risk scoring model
* Basic impact estimation models

---

## How It Works

1. Weather and environmental data are collected and processed.
2. Flood risk is computed using rainfall, elevation, and forecast trends.
3. The system identifies safe and unsafe zones on the map.
4. Routing algorithm generates the safest path based on risk-aware scoring.
5. Nearby shelters are evaluated and the best option is selected.
6. Users are guided through navigation while receiving alerts and insights.
7. Simulation module allows users to experience flood scenarios and learn decision-making.

---

## Setup Instructions

1. Clone the repository
2. Install dependencies
3. Configure API keys for weather services
4. Run the backend server
5. Launch the frontend application
6. Open the application in a browser

---

## Future Enhancements

* Integration of real-time IoT sensor data for water levels
* Machine learning models trained on historical flood datasets
* More accurate population and mobility tracking
* Offline mode for low connectivity scenarios
* Advanced visualization with heatmaps and animations

---

## Use Cases

* Emergency evacuation planning
* Disaster response and management
* Public awareness and education
* Smart city safety systems

---

## Conclusion

This project demonstrates how data science, geospatial analysis, and intelligent systems can be combined to address real-world disaster management challenges. By focusing on both prevention and awareness, it provides a comprehensive solution for improving safety during flood events.
