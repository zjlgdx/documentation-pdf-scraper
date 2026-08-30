local function has_class(element, expected)
  for _, class_name in ipairs(element.classes) do
    if class_name == expected then
      return true
    end
  end
  return false
end

function Span(element)
  if not has_class(element, 'english-annotation-source') or not FORMAT:match('latex') then
    return nil
  end

  local rendered = { pandoc.RawInline('latex', '\\englishannotationsource{') }
  for _, inline in ipairs(element.content) do
    rendered[#rendered + 1] = inline
  end
  rendered[#rendered + 1] = pandoc.RawInline('latex', '}')
  return rendered
end

local function wrap_blocks(environment, blocks)
  local rendered = {
    pandoc.RawBlock('latex', '\\begin{' .. environment .. '}')
  }
  for _, block in ipairs(blocks) do
    rendered[#rendered + 1] = block
  end
  rendered[#rendered + 1] = pandoc.RawBlock('latex', '\\end{' .. environment .. '}')
  return rendered
end

function Div(element)
  if not FORMAT:match('latex') then
    return nil
  end
  if has_class(element, 'english-annotation') then
    return wrap_blocks('englishannotationbox', element.content)
  end
  if has_class(element, 'english-learning-review') then
    return wrap_blocks('englishreviewbox', element.content)
  end
  return nil
end
