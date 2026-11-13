const id = new URLSearchParams(location.search).get('id');
if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '')) {
  const pdf = '/api/v1/notifications/' + encodeURIComponent(id) + '/pdf';
  const link = document.getElementById('open-pdf');
  const frame = document.getElementById('pdf-frame');
  link.href = pdf;
  link.hidden = false;
  frame.src = pdf;
  frame.hidden = false;
} else {
  document.getElementById('pdf-error').hidden = false;
}
