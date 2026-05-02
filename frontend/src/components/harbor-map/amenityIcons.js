import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  Anchor, Fuel, Toilet, ShowerHead, UtensilsCrossed,
  ParkingSquare, Zap, Waves, DoorClosed, Trash, Store, Cross,
} from 'lucide-react';

const ICON_MAP = {
  harbour_master: Anchor,
  fuel:           Fuel,
  toilets:        Toilet,
  showers:        ShowerHead,
  restaurant:     UtensilsCrossed,
  parking:        ParkingSquare,
  electricity:    Zap,
  water:          Waves,
  gate:           DoorClosed,
  waste:          Trash,
  chandlery:      Store,
  first_aid:      Cross,
};

function iconToDataUrl(IconComponent) {
  const svg = renderToStaticMarkup(
    createElement(IconComponent, { size: 24, color: 'white', strokeWidth: 2 })
  );
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export const AMENITY_ICONS = Object.fromEntries(
  Object.entries(ICON_MAP).map(([type, Icon]) => [type, iconToDataUrl(Icon)])
);
