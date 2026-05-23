
/**
 * raceTracker Interactive Charts
 * Adds interactivity to the data visualization dashboard
 */

document.addEventListener('DOMContentLoaded', function() {
    // Initialize interactive elements
    initChartInteractions();
    initTelemetryUpdates();
    initWorkshopInteractions();
});

function initChartInteractions() {
    // Make lap time bars interactive
    const lapBars = document.querySelectorAll('.chart-bar');
    lapBars.forEach((bar, index) => {
        bar.addEventListener('mouseenter', () => {
            // Show tooltip with exact value
            const height = parseInt(bar.style.height) || 0;
            const value = Math.round((height / 100) * 100); // Scale to 0-100
            showTooltip(bar, `Lap Time Score: ${value}/100`);
        });
        
        bar.addEventListener('mouseleave', () => {
            hideTooltip();
        });
        
        // Animate bar height on load
        setTimeout(() => {
            const targetHeight = bar.style.height;
            bar.style.height = '0%';
            // Force reflow
            void bar.offsetWidth;
            bar.style.height = targetHeight;
        }, index * 100);
    });
    
    // Make pie chart segments interactive
    const pieSegments = document.querySelectorAll('.pie-segment');
    pieSegments.forEach((segment, index) => {
        segment.addEventListener('mouseenter', () => {
            const labels = ['< 80 km/h', '80-90 km/h', '90-100 km/h', '> 100 km/h'];
            const percentages = [40, 30, 20, 10];
            showTooltip(segment, `${labels[index]}: ${percentages[index]}%`);
        });
        
        segment.addEventListener('mouseleave', () => {
            hideTooltip();
        });
    });
}

function initTelemetryUpdates() {
    // Simulate live telemetry updates
    setInterval(() => {
        // Update lap times with small random variations
        const lapTime1 = document.querySelector('#telemetry .telemetry-card:nth-child(1) .data-item:nth-child(1) .value');
        const lapTime2 = document.querySelector('#telemetry .telemetry-card:nth-child(2) .data-item:nth-child(1) .value');
        
        if (lapTime1 && lapTime2) {
            // Parse current times
            let time1 = parseFloat(lapTime1.textContent);
            let time2 = parseFloat(lapTime2.textContent);
            
            // Add small random variation (-0.5 to +0.5 seconds)
            time1 += (Math.random() - 0.5);
            time2 += (Math.random() - 0.5);
            
            // Keep within reasonable bounds
            time1 = Math.max(40, Math.min(50, time1));
            time2 = Math.max(40, Math.min(50, time2));
            
            // Update display
            lapTime1.textContent = time1.toFixed(3) + 's';
            lapTime2.textContent = time2.toFixed(3) + 's';
        }
        
        // Update speeds
        const speed1 = document.querySelector('#telemetry .telemetry-card:nth-child(1) .data-item:nth-child(2) .value');
        const speed2 = document.querySelector('#telemetry .telemetry-card:nth-child(2) .data-item:nth-child(2) .value');
        
        if (speed1 && speed2) {
            let spd1 = parseFloat(speed1.textContent);
            let spd2 = parseFloat(speed2.textContent);
            
            spd1 += (Math.random() - 0.5) * 2;
            spd2 += (Math.random() - 0.5) * 2;
            
            spd1 = Math.max(80, Math.min(100, spd1));
            spd2 = Math.max(80, Math.min(100, spd2));
            
            speed1.textContent = spd1.toFixed(1) + ' km/h';
            speed2.textContent = spd2.toFixed(1) + ' km/h';
        }
        
        // Update RPMs
        const rpm1 = document.querySelector('#telemetry .telemetry-card:nth-child(1) .data-item:nth-child(3) .value');
        const rpm2 = document.querySelector('#telemetry .telemetry-card:nth-child(2) .data-item:nth-child(3) .value');
        
        if (rpm1 && rpm2) {
            let rp1 = parseInt(rpm1.textContent.replace(/,/g, ''));
            let rp2 = parseInt(rpm2.textContent.replace(/,/g, ''));
            
            rp1 += Math.floor((Math.random() - 0.5) * 200);
            rp2 += Math.floor((Math.random() - 0.5) * 200);
            
            rp1 = Math.max(11000, Math.min(13000, rp1));
            rp2 = Math.max(11000, Math.min(13000, rp2));
            
            rpm1.textContent = rp1.toLocaleString();
            rpm2.textContent = rp2.toLocaleString();
        }
        
        // Update temperatures
        const temp1 = document.querySelector('#telemetry .telemetry-card:nth-child(1) .data-item:nth-child(4) .value');
        const temp2 = document.querySelector('#telemetry .telemetry-card:nth-child(2) .data-item:nth-child(4) .value');
        
        if (temp1 && temp2) {
            let t1 = parseInt(temp1.textContent);
            let t2 = parseInt(temp2.textContent);
            
            t1 += Math.floor((Math.random() - 0.5) * 4);
            t2 += Math.floor((Math.random() - 0.5) * 4);
            
            t1 = Math.max(75, Math.min(95, t1));
            t2 = Math.max(75, Math.min(95, t2));
            
            temp1.textContent = t1 + '°C';
            temp2.textContent = t2 + '°C';
        }
    }, 3000); // Update every 3 seconds
}

function initWorkshopInteractions() {
    // Make task items clickable to toggle status
    const taskItems = document.querySelectorAll('.task-item');
    taskItems.forEach(item => {
        item.addEventListener('click', function(e) {
            // Don't toggle if clicking on the status span directly
            if (e.target.classList.contains('task-status')) return;
            
            const statusSpan = this.querySelector('.task-status');
            const currentStatus = statusSpan.className.split(' ')[1]; // Get the status class
            
            // Cycle through statuses: pending -> in-progress -> completed -> pending
            const statusOrder = ['pending', 'in-progress', 'completed'];
            let currentIndex = statusOrder.indexOf(currentStatus);
            if (currentIndex === -1) currentIndex = 0;
            
            const nextIndex = (currentIndex + 1) % statusOrder.length;
            const nextStatus = statusOrder[nextIndex];
            
            // Update class and text
            statusSpan.className = `task-status ${nextStatus}`;
            statusSpan.textContent = 
                nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1).replace('-', ' ');
        });
    });
    
    // Make inventory items editable on double click
    const inventoryItems = document.querySelectorAll('.inventory-item .part-qty');
    inventoryItems.forEach(item => {
        item.addEventListener('dblclick', function() {
            const currentValue = this.textContent;
            const input = document.createElement('input');
            input.type = 'number';
            input.value = currentValue.replace(/\D/g, ''); // Extract numbers only
            input.style.width = '60px';
            input.style.textAlign = 'center';
            
            this.textContent = '';
            this.appendChild(input);
            input.focus();
            
            const saveValue = () => {
                const newValue = input.value || '0';
                // Format with appropriate units
                const parent = this.parentElement;
                const partName = parent.querySelector('.part-name').textContent;
                
                let formattedValue = newValue;
                if (partName.includes('Tires')) formattedValue = newValue + ' sets';
                else if (partName.includes('Brake Pads')) formattedValue = newValue + ' pcs';
                else if (partName.includes('Engine Oil')) formattedValue = newValue + ' liters';
                else if (partName.includes('Spark Plugs')) formattedValue = newValue + ' pcs';
                else formattedValue = newValue;
                
                this.textContent = formattedValue;
                this.removeEventListener('keydown', handleEnter);
                this.removeEventListener('blur', saveValue);
            };
            
            const handleEnter = (e) => {
                if (e.key === 'Enter') {
                    saveValue();
                }
            };
            
            input.addEventListener('keydown', handleEnter);
            input.addEventListener('blur', saveValue);
        });
    });
}

function showTooltip(element, text) {
    // Remove any existing tooltip
    hideTooltip();
    
    const tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    tooltip.textContent = text;
    document.body.appendChild(tooltip);
    
    const rect = element.getBoundingClientRect();
    tooltip.style.left = (rect.left + rect.width / 2) + 'px';
    tooltip.style.top = (rect.top - 10) + 'px';
}

function hideTooltip() {
    const tooltips = document.querySelectorAll('.chart-tooltip');
    tooltips.forEach(t => t.remove());
}

// Add CSS for tooltips
const style = document.createElement('style');
style.textContent = `
.chart-tooltip {
    position: absolute;
    background-color: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.8rem;
    pointer-events: none;
    z-index: 1000;
    transform: translateX(-50%);
    transition: opacity 0.2s ease;
    opacity: 0;
}

.chart-tooltip.show {
    opacity: 1;
}

/* Animate tooltip appearance */
@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.chart-tooltip {
    animation: fadeIn 0.2s ease-out;
}
`;
document.head.appendChild(style);
