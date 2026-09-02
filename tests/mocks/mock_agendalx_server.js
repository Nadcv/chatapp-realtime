const http = require('http');
http.createServer((req, res) => {
  const events = [
    {
      id: 1,
      title: { rendered: 'Vertigens' },
      // Formato real confirmado em produção: subtitle e description vêm
      // como listas de strings, não como objeto {rendered} nem string simples.
      subtitle: ['2026'],
      description: ['Uma peça sobre o <strong>equilíbrio</strong> e a queda,', 'com coreografia original.'],
      string_dates: '12 a 20 de setembro',
      string_times: '21h30',
      venue: { id: 5, slug: 'teatro-sao-luiz', name: 'Teatro São Luiz' },
      featured_media_large: 'https://example.test/vertigens.jpg',
      categories_name_list: [{ name: 'Dança' }, { name: 'Teatro' }],
      link: 'https://www.agendalx.pt/events/event/vertigens-real-link/',
      slug: 'vertigens'
    },
    {
      id: 2,
      title: { rendered: 'Vitorino ao vivo' },
      subtitle: '',
      string_dates: '25 de setembro',
      string_times: '20h00',
      venue: { id: 6, slug: 'coliseu', name: 'Coliseu dos Recreios' },
      featured_media_large: null,
      categories_name_list: [{ name: 'Música' }],
      slug: 'vitorino'
    },
    {
      id: 3,
      title: { rendered: 'Feira do Livro' },
      subtitle: '',
      string_dates: '1 a 15 de outubro',
      string_times: '10h00 - 20h00',
      venue: { id: 7, slug: 'eduardo-vii', name: 'Parque Eduardo VII' },
      featured_media_large: null,
      // Reproduz o formato real visto em produção: um objeto, não uma lista
      // (a versão anterior do código fazia .map() diretamente nisto e
      // rebentava, derrubando a lista inteira de eventos).
      categories_name_list: { 12: { name: 'Livros' }, 13: { name: 'Cultura' } },
      slug: 'feira-do-livro'
    }
  ];
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(events));
}).listen(3012, () => console.log('mock Agenda Cultural de Lisboa server on :3012'));
