 const riderTab = document.getElementById('rider-tab');
    const userTab = document.getElementById('user-tab');
    const riderControls = document.getElementById('rider-controls');
    const userControls = document.getElementById('user-controls');
    const mapContainer = document.getElementById('map-container');
    const mapInstructions = document.getElementById('map-instructions');

    const riderStartInput = document.getElementById('rider-start');
    const riderEndInput = document.getElementById('rider-end');
    const userLocationInput = document.getElementById('user-location');
    const userDestinationInput = document.getElementById('user-destination');

    const createRideBtn = document.getElementById('create-ride');
    const findRideBtn = document.getElementById('find-ride');

    const alertBox = document.getElementById('alert-box');
    const alertText = document.getElementById('alert-text');
    const ridersList = document.getElementById('riders-list');
    
    // --- Map & State ---
    let map;
    let mapLayers = {
        riders: L.layerGroup(), // This layer group is now effectively unused for routes, but kept for structure.
        currentUser: L.layerGroup()
    };
    
    let appState = {
        mode: null,
        setting: null,
        riders: [],
        currentUser: {
            location: null,
            destination: null
        },
    };

    // --- Core Logic & Geometry ---
    function geoDistanceToLineSegment(p, v, w) {
        const pPoint = map.latLngToLayerPoint(p);
        const vPoint = map.latLngToLayerPoint(v);
        const wPoint = map.latLngToLayerPoint(w);
        
        const l2 = vPoint.distanceTo(wPoint) ** 2;
        if (l2 === 0) return p.distanceTo(v);
        
        let t = ((pPoint.x - vPoint.x) * (wPoint.x - vPoint.x) + (pPoint.y - vPoint.y) * (wPoint.y - vPoint.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        
        const projectionPoint = L.point(vPoint.x + t * (wPoint.x - vPoint.x), vPoint.y + t * (wPoint.y - vPoint.y));
        const projectionLatLng = map.layerPointToLatLng(projectionPoint);

        return p.distanceTo(projectionLatLng);
    }
    
    function geoDistanceToPolyline(p, latlngs) {
        let minDistance = Infinity;
        for (let i = 0; i < latlngs.length - 1; i++) {
            const dist = geoDistanceToLineSegment(p, latlngs[i], latlngs[i + 1]);
            if (dist < minDistance) {
                minDistance = dist;
            }
        }
        return minDistance;
    }

    function setMode(mode) {
        appState.mode = mode;
        appState.setting = null;
        riderTab.classList.toggle('tab-active', mode === 'rider');
        userTab.classList.toggle('tab-active', mode === 'user');
        riderControls.classList.toggle('hidden', mode !== 'rider');
        userControls.classList.toggle('hidden', mode !== 'user');
        resetInputs();
        redrawMap();
    }

    function handleMapClick(e) {
        if (!appState.setting) return;
        const latlng = e.latlng;
        const input = document.getElementById(appState.setting);
        input.value = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;

        switch(appState.setting) {
            case 'rider-start': appState.currentUser.riderStart = latlng; break;
            case 'rider-end': appState.currentUser.riderEnd = latlng; break;
            case 'user-location': appState.currentUser.location = latlng; break;
            case 'user-destination': appState.currentUser.destination = latlng; break;
        }
        redrawMap();
    }

    function createRide() {
        if (!appState.currentUser.riderStart || !appState.currentUser.riderEnd) {
            showAlert('Please set both start and end locations for the ride.', 'error');
            return;
        }

        const start = appState.currentUser.riderStart;
        const end = appState.currentUser.riderEnd;
        const riderId = appState.riders.length + 1;

        const newRider = {
            id: 'Rider-' + riderId,
            start: start,
            end: end,
            routeControl: null,
            routeCoordinates: null,
        };

        const routeControl = L.routing.control({
            waypoints: [start, end],
            router: L.routing.osrmv1({
                serviceUrl: 'https://router.project-osrm.org/route/v1'
            }),
            routeWhileDragging: false,
            addWaypoints: false,
            lineOptions: {
                styles: [{ color: '#818cf8', weight: 5, opacity: 0.9 }]
            },
            createMarker: function(i, waypoint) {
                const color = i === 0 ? '#a78bfa' : '#f472b6';
                return L.marker(waypoint.latLng, { icon: createIcon(color, 16) });
            }
        }).on('routesfound', function(e) {
            console.log('Route found:', e);
            newRider.routeCoordinates = e.routes[0].coordinates;
            showAlert(`Route for Rider-${riderId} created successfully!`, 'success');
        }).on('routingerror', function(e) {
            console.error('Routing error:', e);
            let errorMessage = 'Could not find a route. The routing service may be temporarily unavailable.';
            if (e && e.error && e.error.message) {
                 if (e.error.message.toLowerCase().includes("no route found")) {
                    errorMessage = "No roads found between these two points. Please select different locations.";
                } else {
                     errorMessage = `Routing Error: ${e.error.message}`;
                }
            }
            showAlert(errorMessage, 'error');
            
            appState.riders = appState.riders.filter(r => r.id !== newRider.id);
            // Manually remove the failed route control from the map
            if (newRider.routeControl) {
                map.removeControl(newRider.routeControl);
            }
        });
        
        newRider.routeControl = routeControl;
        appState.riders.push(newRider);

        // **FIX:** Add the new route control directly to the map itself, not a layer group.
        routeControl.addTo(map);
        
        showAlert(`Calculating route for Rider-${riderId}...`, 'info');
        resetInputs(true);
        // Redraw map to clear the temporary dashed line for the rider preview
        redrawMap();
    }

    function findRides() {
        if (!appState.currentUser.location || !appState.currentUser.destination) {
            showAlert('Please set your location and destination first.', 'error');
            return;
        }

        const proximityRadius = 500; // 500 meters
        const destinationTolerance = 300; // 300m tolerance
        
        const foundRiders = appState.riders.filter(rider => {
            if (!rider.routeCoordinates) return false;

            const distToPath = geoDistanceToPolyline(appState.currentUser.location, rider.routeCoordinates);
            if (distToPath > proximityRadius) return false;

            const distOfDestToPath = geoDistanceToPolyline(appState.currentUser.destination, rider.routeCoordinates);
            if (distOfDestToPath > destinationTolerance) return false;
            
            // Heuristic: check that user destination is generally further from ride start than user location is
            const riderStartToUserLoc = rider.start.distanceTo(appState.currentUser.location);
            const riderStartToUserDest = rider.start.distanceTo(appState.currentUser.destination);
            if (riderStartToUserDest < riderStartToUserLoc) return false;

            return true;
        });

        updateRidersList(foundRiders);

        if (foundRiders.length > 0) {
            showAlert(`${foundRiders.length} rider(s) found heading your way!`, 'success');
        } else {
            showAlert('No suitable riders found in your area. Please try again later.', 'info');
        }
    }

    // --- UI Update Functions ---
    function updateRidersList(foundRiders) {
        ridersList.innerHTML = '';
        if (foundRiders.length === 0) {
            ridersList.innerHTML = '<p class="text-gray-500 text-center">No active riders found nearby.</p>';
            return;
        }
        foundRiders.forEach(rider => {
            const riderEl = document.createElement('div');
            riderEl.className = 'bg-gray-700 p-3 rounded-lg hover:bg-gray-600 cursor-pointer';
            riderEl.innerHTML = `<p class="font-medium">${rider.id}</p><p class="text-xs text-gray-400">Route is nearby</p>`;
            ridersList.appendChild(riderEl);
        });
    }

    function showAlert(message, type = 'info') {
        alertBox.classList.remove('hidden', 'bg-green-500', 'bg-red-500', 'bg-blue-500');
        let colorClass = 'bg-blue-500';
        if (type === 'success') colorClass = 'bg-green-500';
        if (type === 'error') colorClass = 'bg-red-500';
        alertBox.classList.add(colorClass);
        alertText.textContent = message;
        setTimeout(() => { alertBox.classList.add('hidden'); }, 5000);
    }
    
    function resetInputs(keepRiders = false) {
        riderStartInput.value = '';
        riderEndInput.value = '';
        userLocationInput.value = '';
        userDestinationInput.value = '';
        appState.currentUser = { location: null, destination: null };
        if(!keepRiders) {
             ridersList.innerHTML = '<p class="text-gray-500 text-center">Search to see available riders.</p>';
        }
    }
    
    // --- Map Drawing ---
    function createIcon(color, size = 16) {
        return L.divIcon({
            html: `<div class="map-icon" style="background-color: ${color}; width: ${size}px; height: ${size}px;"></div>`,
            className: '', iconSize: [size, size], iconAnchor: [size/2, size/2]
        });
    }

    function redrawMap() {
        // This function now only manages temporary layers for the current user/action.
        // Permanent rider routes are managed by their own controls and are not touched here.
        mapLayers.currentUser.clearLayers();

        // Draw current user's points
        if (appState.mode === 'user') {
            if (appState.currentUser.location) {
                L.circle(appState.currentUser.location, { radius: 500, color: '#facc15', fillOpacity: 0.1, weight: 2 }).addTo(mapLayers.currentUser);
                L.marker(appState.currentUser.location, { icon: createIcon('#2dd4bf', 20) }).addTo(mapLayers.currentUser);
            }
            if (appState.currentUser.destination) {
                L.marker(appState.currentUser.destination, { icon: createIcon('#f472b6', 20) }).addTo(mapLayers.currentUser);
            }
        }
        
        // Draw current rider's pending path (straight dashed line for preview)
        if (appState.mode === 'rider') {
             if (appState.currentUser.riderStart && appState.currentUser.riderEnd) {
                 L.polyline([appState.currentUser.riderStart, appState.currentUser.riderEnd], { color: '#a5b4fc', weight: 4, dashArray: '5, 10' }).addTo(mapLayers.currentUser);
             }
             if (appState.currentUser.riderStart) {
                L.marker(appState.currentUser.riderStart, { icon: createIcon('#a78bfa', 20) }).addTo(mapLayers.currentUser);
             }
             if(appState.currentUser.riderEnd) {
                L.marker(appState.currentUser.riderEnd, { icon: createIcon('#f472b6', 20) }).addTo(mapLayers.currentUser);
             }
        }
    }
    
    // --- Initial Setup ---
    function initMap() {
        // Bhubaneswar, Odisha, India Coordinates
        map = L.map('map-container').setView([20.2961, 85.8245], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        mapLayers.riders.addTo(map);
        mapLayers.currentUser.addTo(map);
        map.on('click', handleMapClick);
        map.whenReady(() => mapInstructions.classList.add('hidden'));
    }

    // --- Event Listeners ---
    riderTab.addEventListener('click', () => setMode('rider'));
    userTab.addEventListener('click', () => setMode('user'));
    riderStartInput.addEventListener('focus', () => appState.setting = 'rider-start');
    riderEndInput.addEventListener('focus', () => appState.setting = 'rider-end');
    userLocationInput.addEventListener('focus', () => appState.setting = 'user-location');
    userDestinationInput.addEventListener('focus', () => appState.setting = 'user-destination');
    createRideBtn.addEventListener('click', createRide);
    findRideBtn.addEventListener('click', findRides);
    
    // Initialize
    initMap();
    setMode('rider');
    updateRidersList([]);