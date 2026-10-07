import { renderAttributeValue, renderValue } from '@flowview/runtime';

export function render(context) {
  let output = '';
  output += '<!doctype html>\n';
  output += '<nav';
  const __flowview_classes0 = [];
  const __flowview_class_seen1 = new Set();
  if (!__flowview_class_seen1.has('n')) { __flowview_class_seen1.add('n'); __flowview_classes0.push('n'); }
  if (context.on) {
    if (!__flowview_class_seen1.has('on')) { __flowview_class_seen1.add('on'); __flowview_classes0.push('on'); }
  }
  if (__flowview_classes0.length > 0) {
    output += ' class="';
    output += renderAttributeValue(__flowview_classes0.join(' '));
    output += '"';
  }
  output += '>';
    output += '\n  ';
    const __flowview_items2 = Array.from((context.items) ?? []);
    if (__flowview_items2.length === 0) {
      output += '\n    ';
      output += '<span>none</span>';
      output += '\n  ';
    } else {
      for (const i of __flowview_items2) {
        output += '\n    ';
        output += '<a';
        output += ' href="';
        output += renderValue(i.url);
        output += '"';
        const __flowview_attr3 = i.cur;
        if (__flowview_attr3 !== null && __flowview_attr3 !== undefined) {
          output += ' aria-current="';
          output += renderAttributeValue(__flowview_attr3);
          output += '"';
        }
        if (i.off) output += ' disabled';
        output += '>';
          output += renderValue(i.label);
        output += '</a>';
        output += '\n  ';
      }
    }
    output += '\n';
  output += '</nav>';
  output += '\n';
  if (context.a) {
    output += 'A';
  }   else if (context.b) {
    output += 'B';
  } else {
    output += 'C';
  }
  output += '\n';
  const __flowview_switch4 = context.k;
  switch (__flowview_switch4) {
    case 'x':
      output += 'X';
      break;
    default:
      output += 'D';
  }
  output += '\n';

  return output;
}
