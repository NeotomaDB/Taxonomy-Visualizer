
export function setupHover(nodeSelection) {
    let tooltip = document.getElementById('hover-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'hover-tooltip';
        tooltip.style.position = 'absolute';
        tooltip.style.background = '#fff';
        tooltip.style.border = '1px solid #ddd';
        tooltip.style.padding = '5px 10px';
        tooltip.style.borderRadius = '4px';
        tooltip.style.pointerEvents = 'none'; // Important so mouse doesn't get stuck on tooltip
        tooltip.style.zIndex = '1001';
        tooltip.style.display = 'none';
        tooltip.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
        tooltip.style.fontSize = '12px';
        tooltip.style.fontWeight = '500';
        tooltip.style.color = '#333';
        document.body.appendChild(tooltip);
    }

    nodeSelection
        .on('mouseover.hover', (event, d) => {
            tooltip.style.display = 'block';
            tooltip.textContent = d.data.name;
            tooltip.style.left = (event.pageX + 10) + 'px';
            tooltip.style.top = (event.pageY + 10) + 'px';
        })
        .on('mousemove.hover', (event) => {
            tooltip.style.left = (event.pageX + 10) + 'px';
            tooltip.style.top = (event.pageY + 10) + 'px';
        })
        .on('mouseout.hover', () => {
            tooltip.style.display = 'none';
        });
}
