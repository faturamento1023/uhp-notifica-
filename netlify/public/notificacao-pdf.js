const id = new URLSearchParams(location.search).get('id');
const loading = document.getElementById('pdf-loading');
if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '')) {
  const pdf = '/api/v1/notifications/' + encodeURIComponent(id) + '/pdf';
  const link = document.getElementById('open-pdf');
  const frame = document.getElementById('pdf-frame');
  link.href = pdf;
  link.hidden = false;
  frame.addEventListener('load', () => { loading.hidden = true; frame.hidden = false; });
  frame.addEventListener('error', () => {
    loading.hidden = true;
    document.getElementById('pdf-error').textContent = 'Não foi possível carregar o PDF. Use o link acima para tentar novamente.';
    document.getElementById('pdf-error').hidden = false;
  });
  frame.src = pdf;
} else {
  loading.hidden = true;
  document.getElementById('pdf-error').hidden = false;
}
