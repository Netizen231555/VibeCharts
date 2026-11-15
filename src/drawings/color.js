// Supported plain CSS colors. This validator is independent of the browser so stores validate identically in Node.
const NAMED_COLORS = new Set(`aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato transparent turquoise violet wheat white whitesmoke yellow yellowgreen`.split(' '));
const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i;

function component(value, percentRequired = false) {
  const percent = value.endsWith('%');
  const number = percent ? value.slice(0, -1) : value;
  return (!percentRequired || percent) && NUMBER.test(number) && Number.isFinite(Number(number));
}

export function isPlainColor(value) {
  if (typeof value !== 'string') return false;
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return true;
  if (NAMED_COLORS.has(value.toLowerCase())) return true;
  const match = /^(rgb|rgba|hsl|hsla)\(([^()]*)\)$/i.exec(value);
  if (!match) return false;
  const fn = match[1].toLowerCase();
  const parts = match[2].split(',').map(part => part.trim());
  if (parts.length !== (fn.endsWith('a') ? 4 : 3)) return false;
  if (fn.startsWith('rgb')) {
    const percent = parts[0].endsWith('%');
    if (!parts.slice(0, 3).every(part => part.endsWith('%') === percent && component(part))) return false;
  } else if (!NUMBER.test(parts[0]) || !Number.isFinite(Number(parts[0])) || !component(parts[1], true) || !component(parts[2], true)) return false;
  return parts.length === 3 || component(parts[3]);
}
