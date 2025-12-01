// /y8-studio/unity/config/TemplateData56/responsive.js
(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function(){
	  try {
      if (window.Game && Game.prototype && Game.prototype.resize) {
		  Game.prototype.resize = function(){ /* disabled, responsive.js owns it */ };
		  console.log('[responsive.js] disabled template resize');
		}
	  }
	  catch(e) {
      console.log('Could not disable template resize', e);
    }
  });
  function getUnityCanvas() {
    var c = document.querySelector("#gameContainer canvas");
    return c || null;
  }
  
  function parsePx(str) {
    return Number(String(str).replace(/[^\d.]/g, "")) || 0;
  }

  function onResize() {
    var container = document.getElementById("gameContainer");
    if (!container) return;
	
	var baseW = parsePx(container.style.width);
	var baseH = parsePx(container.style.height);
	
	if (!baseW || !baseH) 
	{
		baseW = Number(container.dataset.baseW || 0);
		baseH = Number(container.dataset.baseH || 0);
	}
	
	if (!baseW || !baseH) 
	{
		baseW = 16;
		baseH = 9;
	}
  
	
    var w = window.innerWidth;
    var h = window.innerHeight;
    var aspectRatio = baseW / baseH; // adjust if you need 4:3, 3:2, etc.

    if (w / h > aspectRatio) {
      w = h * aspectRatio;
    } else {
      h = w / aspectRatio;
    }

    container.style.width = w + "px";
    container.style.height = h + "px";
    container.style.left = (window.innerWidth - w) / 2 + "px";
    container.style.top  = (window.innerHeight - h) / 2 + "px";

    var canvas = getUnityCanvas();
    if (canvas) {
      canvas.style.width  = w + "px";
      canvas.style.height = h + "px";
    }

    console.log("[responsive.js] resize → " + w + "x" + h);
  }

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  document.addEventListener('DOMContentLoaded', onResize);
})();
