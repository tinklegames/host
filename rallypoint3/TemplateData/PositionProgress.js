$(function () {
	// your code goes here
	var image = { width: 960, height: 540 };
	var target = { x: 410, y: 340 };
	
	$(document).ready(updatePointer);
	$(window).resize(updatePointer);

	function updatePointer() {		

		var pointer = $("#unity-loading-bar");
	
		var windowWidth = $(window).width();
		var windowHeight = $(window).height();
		
		// Get largest dimension increase
		var xScale = windowWidth / image.width;
		var yScale = windowHeight / image.height;
		var scale;
		var yOffset = 0;
		var xOffset = 0;

		if (xScale > yScale) {
			// The image fits perfectly in x axis, stretched in y
			scale = xScale;
			yOffset = (windowHeight - (image.height * scale)) / 2;
		} else {
			// The image fits perfectly in y axis, stretched in x
			scale = yScale;
			xOffset = (windowWidth - (image.width * scale)) / 2;
		}

		pointer.css('top', (target.y) * scale + Math.ceil(yOffset));
		pointer.css('left', (target.x) * scale + Math.ceil(xOffset));
		pointer.css('width', Math.ceil(168 * scale));	
		pointer.css('height', Math.ceil(24 * scale));	
		
	}
});
