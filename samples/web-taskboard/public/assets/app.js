const state = { tasks: [], filter: 'all', query: '' }
const nodes = {
  connection: document.querySelector('#connection-state'),
  health: document.querySelector('#health-copy'),
  list: document.querySelector('#task-list'),
  empty: document.querySelector('#empty-state'),
  total: document.querySelector('#total-count'),
  open: document.querySelector('#open-count'),
  done: document.querySelector('#done-count'),
  allFilter: document.querySelector('#all-filter-count'),
  showing: document.querySelector('#showing-count'),
  search: document.querySelector('#search-input'),
  form: document.querySelector('#task-form'),
  title: document.querySelector('#title-input'),
  description: document.querySelector('#description-input'),
  error: document.querySelector('#form-error'),
  toast: document.querySelector('#toast'),
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error?.message || `İstek başarısız: ${response.status}`)
  return result
}

function toast(message) {
  nodes.toast.textContent = message
  nodes.toast.classList.add('visible')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => nodes.toast.classList.remove('visible'), 2400)
}

function formatDate(value) {
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(new Date(`${value.replace(' ', 'T')}Z`))
}

function visibleTasks() {
  return state.tasks.filter((task) => {
    const statusMatches = state.filter === 'all' || state.filter === 'done' && task.done || state.filter === 'open' && !task.done
    const text = `${task.title} ${task.description}`.toLocaleLowerCase('tr-TR')
    return statusMatches && text.includes(state.query.toLocaleLowerCase('tr-TR'))
  })
}

function taskElement(task) {
  const row = document.createElement('article')
  row.className = `task-row${task.done ? ' done' : ''}`

  const toggle = document.createElement('button')
  toggle.className = 'task-toggle'
  toggle.type = 'button'
  toggle.setAttribute('aria-label', task.done ? 'Görevi yeniden aç' : 'Görevi tamamla')
  toggle.textContent = '✓'
  toggle.addEventListener('click', () => updateTask(task.id, !task.done))

  const main = document.createElement('div')
  main.className = 'task-main'
  const title = document.createElement('div')
  title.className = 'task-title'
  title.textContent = task.title
  main.append(title)
  if (task.description) {
    const description = document.createElement('p')
    description.className = 'task-description'
    description.textContent = task.description
    main.append(description)
  }
  const meta = document.createElement('div')
  meta.className = 'task-meta'
  const dot = document.createElement('span')
  dot.className = 'dot'
  const label = document.createElement('span')
  label.textContent = task.done ? 'Tamamlandı' : 'Devam ediyor'
  const date = document.createElement('time')
  date.dateTime = task.created_at.replace(' ', 'T') + 'Z'
  date.textContent = formatDate(task.created_at)
  meta.append(dot, label, date)
  main.append(meta)

  const remove = document.createElement('button')
  remove.className = 'delete-task'
  remove.type = 'button'
  remove.setAttribute('aria-label', `${task.title} görevini sil`)
  remove.textContent = '×'
  remove.addEventListener('click', () => deleteTask(task.id))
  row.append(toggle, main, remove)
  return row
}

function render() {
  const open = state.tasks.filter((task) => !task.done).length
  nodes.total.textContent = String(state.tasks.length)
  nodes.open.textContent = String(open)
  nodes.done.textContent = String(state.tasks.length - open)
  nodes.allFilter.textContent = String(state.tasks.length)
  const tasks = visibleTasks()
  nodes.showing.textContent = `${tasks.length} görev`
  nodes.list.replaceChildren(...tasks.map(taskElement))
  nodes.empty.hidden = tasks.length > 0
}

async function refresh() {
  const [health, result] = await Promise.all([api('/api/health'), api('/api/tasks')])
  state.tasks = result.tasks
  const healthy = health.status === 'ok' && health.database === 'connected'
  nodes.connection.classList.toggle('online', healthy)
  nodes.connection.innerHTML = `<span></span> ${healthy ? 'Yerel veritabanı bağlı' : 'Veritabanı sorunu'}`
  nodes.health.textContent = `API ${healthy ? 'çalışıyor' : 'sorunlu'} · SQLite ${health.sqliteVersion}`
  render()
}

async function updateTask(id, done) {
  try {
    const result = await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) })
    state.tasks = state.tasks.map((task) => task.id === id ? result.task : task)
    render()
    toast(done ? 'Görev tamamlandı' : 'Görev yeniden açıldı')
  } catch (error) { toast(error.message) }
}

async function deleteTask(id) {
  try {
    await api(`/api/tasks/${id}`, { method: 'DELETE' })
    state.tasks = state.tasks.filter((task) => task.id !== id)
    render()
    toast('Görev silindi')
  } catch (error) { toast(error.message) }
}

nodes.form.addEventListener('submit', async (event) => {
  event.preventDefault()
  nodes.error.hidden = true
  const title = nodes.title.value.trim()
  const description = nodes.description.value.trim()
  try {
    const result = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title, description }) })
    state.tasks.unshift(result.task)
    nodes.form.reset()
    state.filter = 'all'
    document.querySelectorAll('.filter').forEach((button) => button.classList.toggle('active', button.dataset.filter === 'all'))
    render()
    nodes.title.focus()
    toast('Görev listene eklendi')
  } catch (error) {
    nodes.error.textContent = error.message
    nodes.error.hidden = false
  }
})

document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
  state.filter = button.dataset.filter
  document.querySelectorAll('.filter').forEach((item) => item.classList.toggle('active', item === button))
  render()
}))
nodes.search.addEventListener('input', () => { state.query = nodes.search.value.trim(); render() })
nodes.title.addEventListener('input', () => { nodes.error.hidden = true })
document.querySelector('#today-label').textContent = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
refresh().catch((error) => {
  nodes.connection.classList.remove('online')
  nodes.connection.innerHTML = '<span></span> Bağlantı kurulamadı'
  nodes.health.textContent = error.message
  toast('Yerel API yanıt vermiyor')
})
