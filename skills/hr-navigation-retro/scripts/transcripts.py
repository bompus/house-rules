"""Selected-file adapters for OpenCode exports, Cursor streams and ACP v1 logs.

No store discovery or recorded-command execution. Adapters emit the same events
as retro.py. ACP state is folded in a first pass so later input/name updates do
not change tool numbering or multiply a single call's results.
"""
import json


def records(path):
    with open(path, errors="replace") as source:
        first = source.readline()
        try:
            record = json.loads(first)
        except ValueError:
            # Pretty-printed session exports are one JSON object, not JSONL.
            if first.strip() == '{':
                source.seek(0)
                record = json.load(source)
                if isinstance(record, dict):
                    yield record
                return
            record = None
        if isinstance(record, dict):
            yield record
        for line in source:
            try:
                record = json.loads(line)
            except ValueError:
                continue
            if isinstance(record, dict):
                yield record


def text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return '\n'.join(text(v) for v in value)
    if isinstance(value, dict):
        for key in ('text', 'content', 'output'):
            if key in value:
                return text(value[key])
        return json.dumps(value)
    return '' if value is None else json.dumps(value)


def tool(name, value, kind=None, locations=None):
    """Normalize documented names/inputs; unknown names remain ordinary tools."""
    names = {'read': 'Read', 'read_file': 'Read', 'grep': 'Grep', 'glob': 'Glob',
             'list': 'LS', 'bash': 'exec_command', 'Bash': 'exec_command',
             'write': 'Write', 'edit': 'Edit'}
    if not isinstance(name, str):
        name = None
    if not isinstance(kind, str):
        kind = None
    name = names.get(name, {'read': 'Read', 'search': 'Grep',
                           'edit': 'Edit', 'execute': 'exec_command'}.get(kind, name or 'unknown'))
    if name == 'Read' and not isinstance(value, (dict, str)):
        value = {}
    if not isinstance(value, dict):
        value = value if isinstance(value, str) else json.dumps(value or {})
        return name, value
    if name == 'Read':
        path = value.get('file_path') or value.get('filePath') or value.get('path')
        if not path and isinstance(locations, list) and len(locations) == 1:
            path = locations[0].get('path') if isinstance(locations[0], dict) else None
        return name, path if isinstance(path, str) else ''
    if name in ('Grep', 'Glob'):
        return name, str(value.get('pattern') or json.dumps(value))
    return name, json.dumps(value)


def opencode(record, timestamp):
    info = record.get('info')
    if not isinstance(info, dict) or not isinstance(record.get('messages'), list):
        return
    time = info.get('time') if isinstance(info.get('time'), dict) else {}
    title = info.get('title') if isinstance(info.get('title'), str) else ''
    directory = info.get('directory') if isinstance(info.get('directory'), str) else None
    yield ('meta', directory, title, bool(info.get('parentID')), timestamp(time.get('created')))
    for message in record['messages']:
        if not isinstance(message, dict) or not isinstance(message.get('info'), dict):
            continue
        meta = message['info']
        time = meta.get('time') if isinstance(meta.get('time'), dict) else {}
        stamp = timestamp(time.get('created'))
        path = meta.get('path')
        if isinstance(path, dict) and isinstance(path.get('cwd'), str):
            yield ('context', path['cwd'], stamp)
        role = meta.get('role')
        for part in message.get('parts') if isinstance(message.get('parts'), list) else []:
            if not isinstance(part, dict):
                continue
            if part.get('type') == 'text' and role in ('user', 'assistant'):
                yield (role, text(part.get('text')), stamp)
            elif part.get('type') == 'tool' and role == 'assistant':
                state = part.get('state')
                if not isinstance(state, dict):
                    continue
                times = state.get('time') if isinstance(state.get('time'), dict) else {}
                name, arg = tool(part.get('tool'), state.get('input'))
                call_id = part.get('callID') or part.get('id')
                if not isinstance(call_id, str):
                    continue
                yield ('call', name, arg, call_id, timestamp(times.get('start')) or stamp)
                if state.get('status') in ('completed', 'error'):
                    yield ('result', call_id, text(state.get('output') or state.get('error')),
                           state['status'] == 'error', timestamp(times.get('end')) or stamp)


def acp_update(record):
    params = record.get('params')
    if isinstance(params, dict) and record.get('method') == 'session/update':
        return params.get('sessionId', ''), params.get('update')
    update = record.get('update')
    if isinstance(update, dict):
        return record.get('sessionId', ''), update
    if 'sessionUpdate' in record:
        return record.get('sessionId', ''), record
    return None, None


def acp_calls(path):
    calls = {}
    for record in records(path):
        session, update = acp_update(record)
        if not isinstance(update, dict) or update.get('sessionUpdate') not in ('tool_call', 'tool_call_update'):
            continue
        call_id = update.get('toolCallId')
        if not isinstance(call_id, str):
            continue
        if not isinstance(session, str):
            continue
        state = calls.setdefault((session, call_id), {})
        for key, value in update.items():
            if value is not None:  # ACP v1 null/omission leaves the prior value.
                state[key] = value
    return calls


def acp(record, calls, seen, finished, timestamp):
    session, update = acp_update(record)
    if not isinstance(update, dict) or not isinstance(session, str):
        return
    stamp = timestamp(record.get('timestamp'))
    kind = update.get('sessionUpdate')
    if kind in ('user_message_chunk', 'agent_message_chunk'):
        yield ('user_chunk' if kind.startswith('user') else 'assistant_chunk', text(update.get('content')), stamp)
    elif kind in ('tool_call', 'tool_call_update'):
        call_id = update.get('toolCallId')
        if not isinstance(call_id, str):
            return
        key = (session, call_id)
        state = calls[key]
        if key not in seen:
            seen.add(key)
            name, arg = tool(state.get('name'), state.get('rawInput'), state.get('kind'), state.get('locations'))
            yield ('call', name, arg, call_id, stamp)
        if update.get('status') in ('completed', 'failed') and key not in finished:
            finished.add(key)
            output = state.get('rawOutput')
            content = state.get('content')
            if output is None and isinstance(content, list):
                output = [item.get('content') for item in content if isinstance(item, dict)
                          and item.get('type') == 'content' and isinstance(item.get('content'), dict)
                          and item['content'].get('type') == 'text']
            yield ('result', call_id, text(output),
                   update['status'] == 'failed', stamp)


def cursor(record, seen, timestamp):
    stamp = timestamp(record.get('timestamp_ms')) or timestamp(record.get('timestamp'))
    outer = record.get('tool_call')
    if not isinstance(outer, dict):
        return
    name, args, result = 'unknown', {}, None
    for key, canonical in (('readToolCall', 'Read'), ('writeToolCall', 'Write')):
        value = outer.get(key)
        if isinstance(value, dict):
            name, args, result = canonical, value.get('args'), value.get('result')
            break
    else:
        function = outer.get('function')
        if isinstance(function, dict):
            name, args = function.get('name'), function.get('arguments')
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    pass
            result = outer.get('result')
    name, arg = tool(name, args)
    call_id = record.get('call_id')
    if not isinstance(call_id, str):
        return
    if ('call', call_id) not in seen:
        seen.add(('call', call_id))
        yield ('call', name, arg, call_id, stamp)
    if record.get('subtype') == 'completed' and ('result', call_id) not in seen:
        seen.add(('result', call_id))
        error = isinstance(result, dict) and 'error' in result
        if isinstance(result, dict):
            result = result.get('error') if error else result.get('success', result)
        yield ('result', call_id, text(result), error, stamp)
