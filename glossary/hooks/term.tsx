import type { ClientModule } from 'claude-code'

type Props = { text: string; bold: boolean; color: string }

// A term's word in a reply: a click on it asks for the full explanation or, again, the short one; the pointer leaving it asks for the short one.
const Term: ClientModule<Props, true> = (props, surface) => {
  if (surface.state === undefined) {
    surface.onPointer(event => {
      if (event.type === 'down' && event.button === 'left') surface.post('toggle')
      else if (event.type === 'leave') surface.post('close')
    })
    surface.setState(true)
  }
  return surface.elements.Text({ color: props.color, bold: props.bold, underline: true, children: props.text })
}

export default Term
