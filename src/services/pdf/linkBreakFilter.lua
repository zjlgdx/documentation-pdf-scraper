-- Link text such as "claude.ai/directory/manage" is a single word to TeX, so
-- it cannot wrap and can overflow the right margin. Allow a line break after
-- each slash in link text; the link target is unchanged.
local function break_after_slashes(str)
  if not str.text:find('/', 1, true) then
    return nil
  end

  local rendered = {}
  for segment, slash in str.text:gmatch('([^/]*)(/?)') do
    if segment ~= '' then
      rendered[#rendered + 1] = pandoc.Str(segment)
    end
    if slash ~= '' then
      rendered[#rendered + 1] = pandoc.Str(slash)
      rendered[#rendered + 1] = pandoc.RawInline('latex', '\\allowbreak{}')
    end
  end
  return rendered
end

function Link(element)
  if not FORMAT:match('latex') then
    return nil
  end
  element.content = element.content:walk({ Str = break_after_slashes })
  return element
end
