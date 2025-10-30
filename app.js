// TODO
// remove hide button
// something is happening with reset not fully resetting?

// Global vars
let map;
let markers = [];
let allLocations = [];
let filteredLocations = [];
let currentDateIndex = 0;
let availableDates = [];
let animationInterval = null;
let isPlaying = false;
let animationIndex = 0;
let animatedMarker = null;
let trailPolyline = null;
let currentMarkers = [];

// Init map
function initMap() {
  // Init map around LA
  map = L.map('map').setView([34.0522, -118.2437], 10);

  // Add tile layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: 'OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  // Refresh on map move
  map.on('moveend', refreshInsights);
  map.on('zoomend', refreshInsights);
}

function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i<line.length;i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function parseDateTime(dateStr) {
  dateStr = dateStr.replace(/^["']|["']$/g, '').trim();

  // big yikes
  const customFormatMatch = dateStr.match(/(\w+)\s+(\d+),\s+(\d+)\s+\((\d+):(\d+):(\d+)\)/i)

  if (customFormatMatch == null) {
    const date = new Date(dateStr);

    if (!isNaN(date.getTime())) {
      return date;
    }  

    return;
  }

  const [_, month, day, year, hours, minutes, seconds] = customFormatMatch;

  const monthMap = {
    "jan": 0, "feb": 1, "mar": 2, "apr": 3, "may": 4, "jun": 5,
    "jul": 6, "aug": 7, "sep": 8, "oct": 9, "nov": 10, "dec": 11
  };

  const monthIndex = monthMap[month.toLowerCase()];
  if (monthIndex != undefined) {
    const date = new Date(year, monthIndex, day, hours, minutes, seconds);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
}

// Parse CSV
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const data = [];

  for (let i=1; i<lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);

    if (values.length >=4) {
      const location = {
        latitude: parseFloat(values[0]),
        longitude: parseFloat(values[1]),
        datetime: parseDateTime(values[2]),
        name: values[3] || 'No name',
      }

      if (!isNaN(location.latitude) && !isNaN(location.longitude) && location.datetime != undefined && !isNaN(location.datetime.getTime())) {
        data.push(location)
      }
    }
  }

  return data;
}

// Load CSV

document.getElementById('file-input').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;

  document.getElementById('file-name').textContent = file.name;
  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    allLocations = parseCSV(text);

    if (allLocations.length === 0) {
      alert('No valid locations in the file');
      return;
    }

    // sort by date
    allLocations.sort((a,b) => a.datetime.getTime() - b.datetime.getTime());

    // get unique dates
    const dateSet = new Set();
    allLocations.forEach(loc => {
      const dateStr = loc.datetime.toISOString().split('T')[0];
      dateSet.add(dateStr);
    });
    availableDates = Array.from(dateSet).sort();

    // set initial
    currentDateIndex = 0;
    document.getElementById('date-picker').value = availableDates[currentDateIndex];
    document.getElementById('date-picker').min = availableDates[0];
    document.getElementById('date-picker').max = availableDates[availableDates.length - 1];

    // enable controls
    document.getElementById('prev-day').disabled = false
    document.getElementById('next-day').disabled = false
    document.getElementById('play-pause').disabled = false
    document.getElementById('reset-animation').disabled = false
    document.getElementById('toggle-insights').disabled = false;

    // load initial view
    updateView();
  }

  reader.readAsText(file);
});

function filterLocationsByRange() {
  const timeRange = document.getElementById('time-range').value;
  const selectedDate = document.getElementById('date-picker').value;
  const startDate = new Date(selectedDate);
  startDate.setHours(0, 0, 0, 0);

  let endDate = new Date(startDate);

  switch (timeRange) {
    case 'day':
      endDate.setDate(endDate.getDate() + 1);
      break;
    case 'week':
      endDate.setDate(endDate.getDate() + 7);
      break;
    case 'month':
      endDate.setDate(endDate.getDate() + 30);
      break;
    case 'year':
      endDate.setFullYear(endDate.getFullYear() + 1);
      break;
  }
  
  return allLocations.filter(loc => loc.datetime >= startDate && loc.datetime <= endDate);
}

function aggregateLocations(locations) {
  const granularity = document.getElementById('granularity').value;

  if (granularity === 'location') {
    return locations;
  }

  if (granularity === 'day') {
    const dayMap = new Map();

    locations.forEach(loc => {
      const dateStr = loc.datetime.toISOString().split('T')[0];

      if (!dayMap.has(dateStr)) {
        dayMap.set(dateStr, {
          locations: [],
          date: new Date(dateStr),
          dateStr: dateStr,
        });
      }

      dayMap.get(dateStr).locations.push(loc);
    });

    const aggregated = [];
    dayMap.forEach((day, dateStr) => {
      aggregated.push({
        datetime: day.date,
        dateStr,
        locations: day.locations,
        isAggregated: true,
        name: `${day.locations.length} locations on ${dateStr}`,
      });
    });

    return aggregated.sort((a, b) => a.datetime - b.datetime);
  }

  return locations;
}

function updateView() {
  filteredLocations = filterLocationsByRange();
  filteredLocations = aggregateLocations(filteredLocations);

  updateTimeline();

  updateMap();

  resetAnimation();
}

function updateTimeline() {
  const timelineList = document.getElementById('timeline-list');
  const selectedDate = document.getElementById('date-picker').value;

  document.getElementById('selected-date').textContent = selectedDate;

  timelineList.innerHTML = '';

  if (filteredLocations.length === 0) {
    timelineList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"></div>
        <p>No locations found for this date range</p>
      </div>
    `;
    return;
  }

  const granularity = document.getElementById('granularity').value;

  if (granularity === 'day' && filteredLocations[0]?.isAggregated) {
    filteredLocations.forEach((dayItem) => {
      const item = document.createElement('div');
      item.className = 'timeline-item timeline-day-item';
      item.dataset.date = dayItem.dateStr;

      const dateInfo = document.createElement('div');
      dateInfo.className = 'timeline-day-info';

      const dateText = document.createElement('span');
      dateText.className = 'timeline-date-text';
      dateText.textContent = dayItem.datetime.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });

      const count = document.createElement('span');
      count.className = 'timeline-count';
      count.textContent = `${dayItem.locations.length} locations`;

      dateInfo.appendChild(dateText);
      item.appendChild(dateInfo);
      item.appendChild(count);

      timelineList.appendChild(item);
    }); 

    return;
  }

  const dateGroups = new Map();
  filteredLocations.forEach((loc, index) => {
    const dateStr = loc.datetime.toISOString().split('T')[0];
    if (!dateGroups.has(dateStr)) {
      dateGroups.set(dateStr, []);
    }

    dateGroups.get(dateStr).push({ ...loc, originalIndex: index });
  });

  // render timeline
  dateGroups.forEach((locations, dateStr) => {
    const dateGroup = document.createElement('div');
    dateGroup.className = 'timeline-date-group';

    const dateHeader = document.createElement('div');
    dateHeader.className = 'timeline-date-header';
    dateHeader.textContent = new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    dateGroup.appendChild(dateHeader);

    locations.forEach(loc => {
      const item = document.createElement('div');
      item.className = 'timeline-item';
      item.dataset.index = loc.originalIndex;

      const time = document.createElement('span');
      time.className = 'timeline-time';
      time.textContent = loc.datetime.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });

      const location = document.createElement('span');
      location.className = 'timeline-location';
      locations.textContent = loc.name;

      item.appendChild(time);
      item.appendChild(location);
      dateGroup.appendChild(item);
    });

    timelineList.appendChild(dateGroup);
  });
}

function updateMap() {
  // clear existing markers
  markers.forEach(marker => map.removeLayer(marker));
  markers = [];

  if (filteredLocations.length === 0) {
    return;
  }

  const granularity = document.getElementById('granularity').value;

  if (granularity === 'day' && filteredLocations[0]?.isAggregated) {
    const allLocations = filteredLocations.flatMap(dayItem => dayItem.locations);

    allLocations.forEach(loc => {
      const marker = L.circleMarker([loc.latitude, loc.longitude], {
        radius: 8,
        fillColor: '#dc3545',
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8,
      }).addTo(map);

      marker.bindPopup(`
        <strong>${loc.name}</strong><br>
        ${loc.datetime.toLocaleString()}
      `);

      markers.push(marker);
    });

    const bounds = L.latLngBounds(
      allLocations.map(loc => [loc.latitude, loc.longitude])
    );
    map.fitBounds(bounds, { padding: [50, 50] });
    return;
  }

  filteredLocations.forEach(loc => {
    const marker = L.circleMarker([loc.latitude, loc.longitude], {
      radius: 8,
      fillColor: '#dc3545',
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8,
    }).addTo(map);

    marker.bindPopup(`
      <strong>${loc.name}</strong><br>
      ${loc.datetime.toLocaleString()}
    `);

    markers.push(marker);
  });

  if (filteredLocations.length > 0) {
    const bounds = L.latLngBounds(
      filteredLocations.map(loc => [loc.latitude, loc.longitude])
    );
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}

function startAnimation() {
  if (filteredLocations.length === 0) return;

  isPlaying = true;
  document.getElementById('play-pause').classList.add('playing');
  document.getElementById('play-icon').textContent = '⏸️';
  document.querySelector('#play-pause').innerHTML = '<span id="play-icon">⏸️</span> Pause';
  document.getElementById('animation-progress').style.display = 'block';

  markers.forEach(marker => map.removeLayer(marker));
  markers = [];
  currentMarkers = [];

  if (trailPolyline) {
    map.removeLayer(trailPolyline);
    trailPolyline = null;
  }

  animateNextFrame();
}

function pauseAnimation() {
  isPlaying = false;
  document.getElementById('play-pause').classList.remove('playing');
  document.getElementById('play-icon').textContent = '▶️';
  document.querySelector('#play-pause').innerHTML = '<span id="play-icon">▶️</span> Play Animation';

  if (animationInterval) {
    clearTimeout(animationInterval);
    animationInterval = null;
  }
}

function resetAnimation() {
  pauseAnimation();
  animationIndex = 0;
  document.getElementById('animation-progress').style.display = 'none';
  document.getElementById('progress-fill').style.width = '0%';

  if (animatedMarker) {
    map.removeLayer(animatedMarker);
    animatedMarker = null;
  }

  if (trailPolyline) {
    map.removeLayer(trailPolyline);
    trailPolyline = null;
  }  

  currentMarkers.forEach(marker => map.removeLayer(marker));
  currentMarkers = [];

  document.querySelectorAll('.timeline-item.active').forEach(item => {
    item.classList.remove('active');
  });

  updateMap();
}

function animateNextFrame() {
  if (!isPlaying || animationIndex >= filteredLocations.length) {
    if (animationIndex >= filteredLocations.length) {
      pauseAnimation();
      document.querySelectorAll('.timeline-item.active').forEach(item => {
        item.classList.remove('active');
      });
    }
  }

  const item = filteredLocations[animationIndex];
  const isAggregated = item?.isAggregated;
  const locations = isAggregated ? item.locations : [item];
  
  // Gray out current markers
  if (animationIndex > 0) {
    currentMarkers.forEach(marker => {
      marker.setStyle({
        radius: isAggregated ? 5 : 6,
        fillOpacity: isAggregated ? 0.25 : 0.3,
        opacity: isAggregated ? 0.4 : 0.45,
      });
    });
  }

  document.querySelectorAll('.timeline-item.active').forEach(item => {
    item.classList.remove('active');
  });

  if (isAggregated) {
    const dateStr = item.dateStr;
    document.querySelectorAll(`.timeline-item[data-date="${dateStr}"]`).forEach(el => {
      el.classList.add('active');
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  } else {
    const activeItem = document.querySelector(`.timeline-item[data-index="${animationIndex}"]`);
    if (activeItem) {
      activeItem.classList.add('active');
      activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // update progress
  const progress = ((animationIndex + 1) / filteredLocations.length) * 100;
  document.getElementById('progress-fill').style.width = progress + '%';

  if (isAggregated) {
    document.getElementById('progress-time').textContent = item.datetime.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    document.getElementById('progress-location').textContent = item.name;
  } else {
    document.getElementById('progress-time').textContent = item.datetime.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    document.getElementById('progress-location').textContent = item.name;
  }

  // add permanent markers for frame
  locations.forEach(loc => {
    const radius = isAggregated ? 9 : 8;
    const weight = isAggregated ? 3 : 2.5;

    const permanentMarker = L.circleMarker([loc.latitude, loc.longitude], {
      radius,
      fillColor: '#dc3545',
      color: '#fff',
      weight,
      opacity: 1,
      fillOpacity: 0.95,
    }).addTo(map);

    permanentMarker.bindPopup(`
      <strong>${loc.name}</strong>
      ${loc.datetime.toLocaleString()}
    `);

    currentMarkers.push(permanentMarker);
  });

  if (animatedMarker) {
    map.removeLayer(animatedMarker);
  }

  let centerLat, centerLng;
  if (isAggregated) {
    centerLat = locations.reduce((sum, loc) => sum + loc.latitude, 0) / locations.length;
    centerLng = locations.reduce((sum, loc) => sum + loc.longitude, 0) / locations.length;
  } else {
    centerLat = item.latitude;
    centerLng = item.longitude;
  }

  const animatedIcon = L.divIcon({
    className: 'animated-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

  // Not sure this is really doing much for us
  // animatedMarker = L.marker([centerLat, centerLng], {
  //   icon: animatedIcon
  // }).addTo(map);

  animationIndex++;

  const speed = parseInt(document.getElementById('speed-slider').value);
  const delay = 1000 / speed; // ms per frame; maybe tweak this

  animationInterval = setTimeout(() => animateNextFrame(), delay);
}

// Event listeners

document.getElementById('play-pause').addEventListener('click', function() {
  if (isPlaying) {
    pauseAnimation();
  } else {
    startAnimation();
  }
});

document.getElementById('reset-animation').addEventListener('click', function() {
  resetAnimation();
});

document.getElementById('speed-slider').addEventListener('input', function(e) {
  document.getElementById('speed-value').textContent = e.target.value + 'x';
});

document.getElementById('prev-day').addEventListener('click', function() {
  if (currentDateIndex > 0) {
    currentDateIndex--;
    document.getElementById('date-picker').value = availableDates[currentDateIndex];
    updateView();
  }
});

document.getElementById('next-day').addEventListener('click', function() {
  if (currentDateIndex < availableDates.length - 1) {
    currentDateIndex++;
    document.getElementById('date-picker').value = availableDates[currentDateIndex];
    updateView();
  }
});

document.getElementById('date-picker').addEventListener('change', function(e) {
  const selectedDate = e.target.value;
  currentDateIndex = availableDates.indexOf(selectedDate);
  if (currentDateIndex === -1) {
    currentDateIndex === 0;
  }
  updateView();
});

document.getElementById('time-range').addEventListener('change', function() {
  updateView();
});

document.getElementById('granularity').addEventListener('change', function() {
  updateView();
});

document.getElementById('toggle-timeline').addEventListener('click', function() {
  const timeline = document.querySelector('.timeline-container');
  const button = document.getElementById('toggle-timeline');

  timeline.classList.toggle('collapsed');

  if (timeline.classList.contains('collapsed')) {
    button.textContent = 'Show';
  } else {
    button.textContent = 'Hide';
  }
});

// Insights

function generateInsights() {
  const dayOfWeekCounts = [0,0,0,0,0,0,0];
  const hourOfDayCounts = Array(24).fill(0);
  const heatmapData = {};

  // init headmap
  for (let day = 0; day < 7; day++) {
    heatmapData[day] = Array(24).fill(0);
  }

  const bounds = map.getBounds();
  
  let locationsInView = 0;
  allLocations.forEach(loc => {
    const latLng = L.latLng(loc.latitude, loc.longitude);

    if (bounds.contains(latLng)) {
      const dayOfWeek = loc.datetime.getDay();
      const hourOfDay = loc.datetime.getHours();

      dayOfWeekCounts[dayOfWeek]++;
      hourOfDayCounts[hourOfDay]++;
      heatmapData[dayOfWeek][hourOfDay]++;
      locationsInView++;
    }
  });

  return {
    dayOfWeek: dayOfWeekCounts,
    hourOfDay: hourOfDayCounts,
    heatmap: heatmapData,
    totalInView: locationsInView,
    totalLocations: allLocations.length,
  }
}

function renderDayOfWeekChart(data) {
  const container = document.getElementById('day-of-week-chart');
  const dayNames = ['Sunday', 'Monday', 'Tuesday','Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const maxValue = Math.max(...data);

  container.innerHTML = '';

  data.forEach((count, index) => {
    const percentage = maxValue > 0 ? (count / maxValue) * 100 : 0;

    const bar = document.createElement('div');
    bar.className = 'chart-bar';

    bar.innerHTML = `
      <div class="chart-label">${dayNames[index]}<div>
      <div class="chart-bar-container">
        <div class="chart-bar-fill" style="width: ${percentage}%">
          <span class="chart-value">${count}</span>
        </div>
      </div>
    `;

    container.appendChild(bar);
  });
}

function renderHourOfDayChart(data) {
  const container = document.getElementById('hour-of-day-chart');
  const maxValue = Math.max(...data);

  container.innerHTML = '';

  data.forEach((count, hour) => {
    const percentage = maxValue > 0 ? (count / maxValue) * 100 : 0;
    const label = hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour-12}pm`;

    const bar = document.createElement('div');
    bar.className = 'chart-bar';

    bar.innerHTML = `
      <div class="chart-label">${label}<div>
      <div class="chart-bar-container">
        <div class="chart-bar-fill" style="width: ${percentage}%">
          <span class="chart-value">${count}</span>
        </div>
      </div>
    `;

    container.appendChild(bar);
  });  
}

function renderHeatMap(data, filterDay = 'all') {
  const container = document.getElementById('heatmap-chart');
  const dayNames = ['Sunday', 'Monday', 'Tuesday','Wednesday', 'Thursday', 'Friday', 'Saturday'];

  container.innerHTML = '';

  // calc for color scale
  let maxValue = 0;
  Object.values(data).forEach(dayData => {
    dayData.forEach(count => {
      if (count > maxValue) maxValue = count;
    });
  });

  const grid = document.createElement('div');
  grid.className = 'heatmap-grid';

  // header
  grid.innerHTML = '<div class="heatmap-row-label"></div>';
  for (let hour = 0; hour < 24; hour++) {
    const headerCell = document.createElement('div');
    headerCell.className = 'heatmap-header';
    headerCell.textContent = hour;
    grid.appendChild(headerCell);
  }

  // data
  const daysToShow = filterDay === 'all' ? [0, 1, 2, 3, 4, 5, 6] : [parseInt(filterDay)];

  daysToShow.forEach(day => {
    const rowLabel = document.createElement('div');
    rowLabel.className = 'heatmap-row-label';
    rowLabel.textContent = dayNames[day];
    grid.appendChild(rowLabel);

    for (let hour = 0; hour < 24; hour++) {
      const count = data[day][hour];
      const intensity = maxValue > 0 ? count / maxValue : 0;

      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      cell.title = `${dayNames[day]} ${hour}:00 - ${count} locations`;

      const hue = 260;
      const saturation = 70;
      const lightness = 90 - (intensity * 60);
      cell.style.background = `hsl(${hue}, ${saturation}%, ${lightness}%)`;

      if (count > 0) {
        cell.textContent = count;
        if (intensity > 0.5) {
          cell.style.color = 'white';
        } else {
          cell.style.color = '#333';
        }
      } else {
        cell.style.background = '#f5f5f5';
        cell.style.color = '#ccc';
      }

      grid.appendChild(cell);
    }
  });

  container.appendChild(grid);
}

function showInsights() {
  const insights = generateInsights();

  document.getElementById('insights-count').innerHTML = 
    `Analyzing <strong>${insights.totalInView}</strong> of ${insights.totalLocations} locations in current view`;
  
    renderDayOfWeekChart(insights.dayOfWeek);
    renderHourOfDayChart(insights.hourOfDay);
    renderHeatMap(insights.heatmap);

    document.getElementById('insights-panel').style.display = 'flex';
}

function refreshInsights() {
  if (document.getElementById('insights-panel').style.display === 'flex') {
    showInsights();
  }
}

function hideInsights() {
  document.getElementById('insights-panel').style.display = 'none';
}

document.getElementById('toggle-insights').addEventListener('click', function() {
  showInsights();
});

document.getElementById('close-insights').addEventListener('click', function() {
  hideInsights();
});

document.getElementById('day-filter').addEventListener('change', function(e) {
  const insights = generateInsights();
  renderHeatMap(insights.heatmap, e.target.value);
});

document.getElementById('refresh-insights').addEventListener('click', function() {
  showInsights();
})

// Init on load
window.addEventListener('load', function() {
  initMap();
})
