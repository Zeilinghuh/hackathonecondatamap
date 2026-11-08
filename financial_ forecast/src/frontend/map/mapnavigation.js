import { constrainView, constrain3DView } from "./mapbounds.js";
import { mercator, latitudeAt } from "./terrainmath.js";

// All input, camera bounds and resizing live here; renderers only draw a view.
export class MapNavigation {
  constructor({canvases, panel, bounds, onChange, onZoom, onSelect, rotate, pan3D}) {
    Object.assign(this, {canvases, panel, bounds, onChange, onZoom, onSelect, rotate, pan3D});
    this.mode = "2d";
    this.pointers = new Map();
    const listen = (type, handler, options) => canvases.forEach(canvas => canvas.addEventListener(type, handler, options));
    const point = event => {
      const rect = event.currentTarget.getBoundingClientRect();
      return {x:event.clientX-rect.left, y:event.clientY-rect.top};
    };
    listen("wheel", event => {
      event.preventDefault();
      const delta = event.deltaY*(event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.view.height : 1);
      this.zoom(Math.exp(-Math.max(-300,Math.min(300,delta))*.002),point(event));
    }, {passive:false});
    listen("dblclick", event => { event.preventDefault(); this.zoom(1.8,point(event)); });
    listen("contextmenu", event => event.preventDefault());
    listen("pointerdown", event => {
      if (event.button !== 0 || this.pointers.size >= 2) return;
      this.cancelFocus();
      event.currentTarget.focus({preventScroll:true});
      event.currentTarget.setPointerCapture(event.pointerId);
      const next = point(event);
      if (!this.pointers.size) {
        this.start = next; this.dragged = false;
        this.rotating = this.mode === "3d" && event.shiftKey;
      }
      this.pointers.set(event.pointerId,next);
      if (this.pointers.size === 2) { this.pinch = this.pinchState(); this.dragged = true; }
      event.currentTarget.classList.add("dragging");
    });
    listen("pointermove", event => {
      if (!this.pointers.has(event.pointerId)) return;
      const previous = this.pointers.get(event.pointerId), next = point(event);
      this.pointers.set(event.pointerId,next);
      if (this.pointers.size === 2) {
        const current = this.pinchState();
        if (this.pinch?.distance > 0) {
          this.zoom(current.distance/this.pinch.distance,this.pinch.centre);
          this.pan(current.centre.x-this.pinch.centre.x,current.centre.y-this.pinch.centre.y);
        }
        this.pinch = current;
      } else {
        if (Math.hypot(next.x-this.start.x,next.y-this.start.y)>4) this.dragged = true;
        if (this.rotating) this.rotate(next.x-previous.x,next.y-previous.y);
        else this.pan(next.x-previous.x,next.y-previous.y);
      }
      this.changed();
    });
    const end = event => {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.delete(event.pointerId);
      if (!this.dragged && event.type === "pointerup" && event.button === 0) this.onSelect(point(event));
      this.pinch = null;
      if (!this.pointers.size) event.currentTarget.classList.remove("dragging");
      else this.start = [...this.pointers.values()][0];
    };
    for (const type of ["pointerup","pointercancel","lostpointercapture"]) listen(type,end);
    listen("keydown", event => {
      const shift = {ArrowLeft:[70,0],ArrowRight:[-70,0],ArrowUp:[0,70],ArrowDown:[0,-70]}[event.key];
      if (!["+","=","-","0"].includes(event.key) && !shift) return;
      event.preventDefault();
      this.cancelFocus();
      if (event.key === "+" || event.key === "=") this.zoom(1.4);
      if (event.key === "-") this.zoom(1/1.4);
      if (event.key === "0") { this.rotate(0,0,true); this.resize(true); }
      if (shift) {
        if (this.mode === "3d" && event.shiftKey) this.rotate(shift[0]/2,shift[1]/2);
        else this.pan(...shift);
        this.changed();
      }
    });
    new ResizeObserver(() => {
      // Animate the camera/layout, but allocate the GPU drawing buffer only
      // after layout settles. Repeated allocations can blank the canvas.
      this.resize(false,false);
      clearTimeout(this.resizeTimer);
      this.resizeTimer=setTimeout(()=>this.resize(),100);
    }).observe(panel);
    this.resize(true);
  }

  pinchState() {
    const [a,b] = [...this.pointers.values()];
    return {distance:Math.hypot(a.x-b.x,a.y-b.y),centre:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};
  }

  changed() {
    (this.mode === "3d" ? constrain3DView : constrainView)(this.view,this.bounds);
    if (this.lastZoom !== this.view.zoom) { this.onZoom(this.view.zoom); this.lastZoom = this.view.zoom; }
    this.onChange();
  }

  setMode(mode) {
    this.cancelFocus();
    this.mode = mode;
    this.pointers.clear(); this.pinch = null;
    this.canvases.forEach(canvas => canvas.classList.remove("dragging"));
    this.canvases[0].focus({preventScroll:true});
    this.changed();
  }

  resize(reset = false, resizeBuffer = true) {
    const {width,height} = this.panel.getBoundingClientRect(), previous = this.view;
    if(reset || previous && (previous.width!==width || previous.height!==height))this.cancelFocus();
    const ratio = Math.min(2,window.devicePixelRatio || 1);
    let changed=false;
    if(resizeBuffer)for(const canvas of this.canvases) {
      if(canvas.width!==Math.round(width*ratio)){canvas.width=Math.round(width*ratio);changed=true;}
      if(canvas.height!==Math.round(height*ratio)){canvas.height=Math.round(height*ratio);changed=true;}
    }
    if (!reset && previous?.width === width && previous?.height === height) {
      if(changed)this.onChange();
      return;
    }
    const [west,south,east,north] = this.bounds, top = mercator(north), span = top-mercator(south);
    const fitScale = Math.min((width-56)/(east-west),(height-56)/span);
    const zoom = previous && !reset ? previous.zoom : 1, scale = fitScale*zoom;
    let offsetX = (width-(east-west)*scale)/2, offsetY = (height-span*scale)/2;
    if (previous && !reset) {
      const lon = (previous.width/2-previous.offsetX)/previous.scale + previous.west;
      const lat = previous.north-(previous.height/2-previous.offsetY)/previous.scale;
      offsetX = width/2-(lon-west)*scale; offsetY = height/2-(top-lat)*scale;
    }
    this.view = {width,height,west,north:top,fitScale,scale,zoom,offsetX,offsetY,focusHeight:reset?0:previous?.focusHeight||0};
    this.changed();
  }

  zoom(factor, anchor) {
    this.cancelFocus();
    const view = this.view;
    if (!anchor || this.mode === "3d") anchor = {x:view.width/2,y:view.height/2};
    const zoom = Math.max(1,Math.min(12,view.zoom*factor)), ratio = zoom/view.zoom;
    view.offsetX = anchor.x-(anchor.x-view.offsetX)*ratio;
    view.offsetY = anchor.y-(anchor.y-view.offsetY)*ratio;
    view.zoom = zoom; view.scale = view.fitScale*zoom;
    this.changed();
  }

  cancelFocus() {
    const flight=this.flight;if(!flight)return;
    this.flight=null;cancelAnimationFrame(flight.raf);flight.resolve();
  }

  focus(bounds,position,project) {
    this.cancelFocus();
    const view=this.view,[west,south,east,north]=bounds;
    const [lon,lat]=position||[(west+east)/2,latitudeAt((south+north)/2)];
    const target={...view},scale=Math.min(view.width*.55/Math.max(.15,east-west),view.height*.55/Math.max(.15,north-south));
    target.zoom=Math.max(1,Math.min(12,scale/view.fitScale));target.scale=view.fitScale*target.zoom;
    target.offsetX=view.width/2-(lon-view.west)*target.scale;
    target.offsetY=view.height/2-(view.north-mercator(lat))*target.scale;
    target.focusHeight=this.mode==='3d'&&project?project([lon,lat],target).height||0:0;
    const constrain=this.mode==='3d'?constrain3DView:constrainView;constrain(target,this.bounds);
    const centre=v=>[(v.width/2-v.offsetX)/v.scale+v.west,v.north-(v.height/2-v.offsetY)/v.scale];
    const from=centre(view),to=centre(target),zoom=view.zoom,height=view.focusHeight||0,start=performance.now();
    const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:850;
    return new Promise(resolve=>{
      const flight=this.flight={resolve};
      const step=now=>{
        if(this.flight!==flight)return;
        const t=duration?Math.min(1,(now-start)/duration):1,e=t*t*(3-2*t);
        view.zoom=zoom*(target.zoom/zoom)**e;view.scale=view.fitScale*view.zoom;
        view.focusHeight=height+(target.focusHeight-height)*e;
        view.offsetX=view.width/2-(from[0]+(to[0]-from[0])*e-view.west)*view.scale;
        view.offsetY=view.height/2-(view.north-from[1]-(to[1]-from[1])*e)*view.scale;
        this.changed();
        if(t<1)flight.raf=requestAnimationFrame(step);else{this.flight=null;resolve();}
      };
      flight.raf=requestAnimationFrame(step);
    });
  }

  pan(dx,dy) {
    if (this.mode === "3d") this.pan3D(this.view,dx,dy);
    else { this.view.offsetX += dx; this.view.offsetY += dy; }
  }
}
