// Seed data module — populates localStorage with demo data on first load.
// Skip seeding if localStorage has data OR if a test flag is set.

const isTestMode = localStorage.getItem('mexicano_test_mode') === 'true';

if (isTestMode) {
  // Tests control their own data — don't seed
} else if (localStorage.getItem('mexicano_members')) {
  console.log('[Seed] Existing data found, skipping seed');
} else {
  // 1. Members
  const members = [
    'Alex', 'Beata', 'Carlos', 'Diana', 'Erik', 'Fatima',
    'Gustav', 'Hanna', 'Igor', 'Julia', 'Karl', 'Laura'
  ];
  localStorage.setItem('mexicano_members', JSON.stringify(members));

  // 2. Current user
  localStorage.setItem('mexicano_current_user', JSON.stringify('Alex'));

  // 3. Matches — 3 tournaments, 4 rounds × 2 matches each
  const matches = [
    // === Tournament 1: 2026-03-01 ===
    // Players: Alex, Beata, Carlos, Diana, Erik, Fatima, Gustav, Hanna
    // Round 1
    { date: '2026-03-01', roundNumber: 1, team1Player1Name: 'Alex',   team1Player2Name: 'Beata',   team2Player1Name: 'Carlos',  team2Player2Name: 'Diana',   scoreTeam1: 15, scoreTeam2: 10, _key: '2026-03-01.01' },
    { date: '2026-03-01', roundNumber: 1, team1Player1Name: 'Erik',   team1Player2Name: 'Fatima',  team2Player1Name: 'Gustav',  team2Player2Name: 'Hanna',   scoreTeam1: 13, scoreTeam2: 12, _key: '2026-03-01.02' },
    // Round 2
    { date: '2026-03-01', roundNumber: 2, team1Player1Name: 'Alex',   team1Player2Name: 'Carlos',  team2Player1Name: 'Erik',    team2Player2Name: 'Gustav',  scoreTeam1: 18, scoreTeam2: 7,  _key: '2026-03-01.03' },
    { date: '2026-03-01', roundNumber: 2, team1Player1Name: 'Beata',  team1Player2Name: 'Diana',   team2Player1Name: 'Fatima',  team2Player2Name: 'Hanna',   scoreTeam1: 11, scoreTeam2: 14, _key: '2026-03-01.04' },
    // Round 3
    { date: '2026-03-01', roundNumber: 3, team1Player1Name: 'Alex',   team1Player2Name: 'Fatima',  team2Player1Name: 'Beata',   team2Player2Name: 'Gustav',  scoreTeam1: 14, scoreTeam2: 11, _key: '2026-03-01.05' },
    { date: '2026-03-01', roundNumber: 3, team1Player1Name: 'Carlos', team1Player2Name: 'Hanna',   team2Player1Name: 'Diana',   team2Player2Name: 'Erik',    scoreTeam1: 20, scoreTeam2: 5,  _key: '2026-03-01.06' },
    // Round 4
    { date: '2026-03-01', roundNumber: 4, team1Player1Name: 'Alex',   team1Player2Name: 'Hanna',   team2Player1Name: 'Carlos',  team2Player2Name: 'Fatima',  scoreTeam1: 12, scoreTeam2: 13, _key: '2026-03-01.07' },
    { date: '2026-03-01', roundNumber: 4, team1Player1Name: 'Beata',  team1Player2Name: 'Erik',    team2Player1Name: 'Diana',   team2Player2Name: 'Gustav',  scoreTeam1: 16, scoreTeam2: 9,  _key: '2026-03-01.08' },

    // === Tournament 2: 2026-03-15 ===
    // Players: Alex, Carlos, Erik, Gustav, Igor, Julia, Karl, Laura
    // Round 1
    { date: '2026-03-15', roundNumber: 1, team1Player1Name: 'Alex',   team1Player2Name: 'Igor',    team2Player1Name: 'Carlos',  team2Player2Name: 'Julia',   scoreTeam1: 17, scoreTeam2: 8,  _key: '2026-03-15.01' },
    { date: '2026-03-15', roundNumber: 1, team1Player1Name: 'Erik',   team1Player2Name: 'Karl',    team2Player1Name: 'Gustav',  team2Player2Name: 'Laura',   scoreTeam1: 10, scoreTeam2: 15, _key: '2026-03-15.02' },
    // Round 2
    { date: '2026-03-15', roundNumber: 2, team1Player1Name: 'Alex',   team1Player2Name: 'Laura',   team2Player1Name: 'Erik',    team2Player2Name: 'Igor',    scoreTeam1: 13, scoreTeam2: 12, _key: '2026-03-15.03' },
    { date: '2026-03-15', roundNumber: 2, team1Player1Name: 'Carlos', team1Player2Name: 'Karl',    team2Player1Name: 'Gustav',  team2Player2Name: 'Julia',   scoreTeam1: 19, scoreTeam2: 6,  _key: '2026-03-15.04' },
    // Round 3
    { date: '2026-03-15', roundNumber: 3, team1Player1Name: 'Alex',   team1Player2Name: 'Gustav',  team2Player1Name: 'Carlos',  team2Player2Name: 'Laura',   scoreTeam1: 11, scoreTeam2: 14, _key: '2026-03-15.05' },
    { date: '2026-03-15', roundNumber: 3, team1Player1Name: 'Erik',   team1Player2Name: 'Julia',   team2Player1Name: 'Igor',    team2Player2Name: 'Karl',    scoreTeam1: 25, scoreTeam2: 0,  _key: '2026-03-15.06' },
    // Round 4
    { date: '2026-03-15', roundNumber: 4, team1Player1Name: 'Alex',   team1Player2Name: 'Karl',    team2Player1Name: 'Erik',    team2Player2Name: 'Laura',   scoreTeam1: 9,  scoreTeam2: 16, _key: '2026-03-15.07' },
    { date: '2026-03-15', roundNumber: 4, team1Player1Name: 'Carlos', team1Player2Name: 'Igor',    team2Player1Name: 'Gustav',  team2Player2Name: 'Julia',   scoreTeam1: 14, scoreTeam2: 11, _key: '2026-03-15.08' },

    // === Tournament 3: 2026-03-29 ===
    // Players: Beata, Diana, Fatima, Hanna, Igor, Julia, Karl, Laura
    // Round 1
    { date: '2026-03-29', roundNumber: 1, team1Player1Name: 'Beata',  team1Player2Name: 'Igor',    team2Player1Name: 'Diana',   team2Player2Name: 'Karl',    scoreTeam1: 16, scoreTeam2: 9,  _key: '2026-03-29.01' },
    { date: '2026-03-29', roundNumber: 1, team1Player1Name: 'Fatima', team1Player2Name: 'Julia',   team2Player1Name: 'Hanna',   team2Player2Name: 'Laura',   scoreTeam1: 12, scoreTeam2: 13, _key: '2026-03-29.02' },
    // Round 2
    { date: '2026-03-29', roundNumber: 2, team1Player1Name: 'Beata',  team1Player2Name: 'Laura',   team2Player1Name: 'Fatima',  team2Player2Name: 'Igor',    scoreTeam1: 8,  scoreTeam2: 17, _key: '2026-03-29.03' },
    { date: '2026-03-29', roundNumber: 2, team1Player1Name: 'Diana',  team1Player2Name: 'Julia',   team2Player1Name: 'Hanna',   team2Player2Name: 'Karl',    scoreTeam1: 15, scoreTeam2: 10, _key: '2026-03-29.04' },
    // Round 3
    { date: '2026-03-29', roundNumber: 3, team1Player1Name: 'Beata',  team1Player2Name: 'Hanna',   team2Player1Name: 'Julia',   team2Player2Name: 'Karl',    scoreTeam1: 13, scoreTeam2: 12, _key: '2026-03-29.05' },
    { date: '2026-03-29', roundNumber: 3, team1Player1Name: 'Diana',  team1Player2Name: 'Laura',   team2Player1Name: 'Fatima',  team2Player2Name: 'Igor',    scoreTeam1: 7,  scoreTeam2: 18, _key: '2026-03-29.06' },
    // Round 4
    { date: '2026-03-29', roundNumber: 4, team1Player1Name: 'Beata',  team1Player2Name: 'Fatima',  team2Player1Name: 'Diana',   team2Player2Name: 'Igor',    scoreTeam1: 11, scoreTeam2: 14, _key: '2026-03-29.07' },
    { date: '2026-03-29', roundNumber: 4, team1Player1Name: 'Hanna',  team1Player2Name: 'Julia',   team2Player1Name: 'Karl',    team2Player2Name: 'Laura',   scoreTeam1: 20, scoreTeam2: 5,  _key: '2026-03-29.08' },
  ];
  localStorage.setItem('mexicano_matches', JSON.stringify(matches));

  // 4. Theme
  localStorage.setItem('mexicano_theme', JSON.stringify('light'));

  // 5. Doodle for April 2026
  const doodle = [
    { name: 'Alex',   selectedDates: ['2026-04-05', '2026-04-12', '2026-04-19'] },
    { name: 'Beata',  selectedDates: ['2026-04-05', '2026-04-12', '2026-04-26'] },
    { name: 'Carlos', selectedDates: ['2026-04-12', '2026-04-19', '2026-04-26'] },
    { name: 'Diana',  selectedDates: ['2026-04-05', '2026-04-19'] },
    { name: 'Erik',   selectedDates: ['2026-04-05', '2026-04-12', '2026-04-19', '2026-04-26'] },
    { name: 'Fatima', selectedDates: ['2026-04-12', '2026-04-26'] },
  ];
  localStorage.setItem('mexicano_doodle_2026-04', JSON.stringify(doodle));

  // 6. Changelog
  const changelog = [
    { playerName: 'Alex',  year: 2026, month: 4, selectedDates: ['2026-04-05', '2026-04-12', '2026-04-19'], timestamp: '2026-04-04T10:30:00Z' },
    { playerName: 'Erik',  year: 2026, month: 4, selectedDates: ['2026-04-05', '2026-04-12', '2026-04-19', '2026-04-26'], timestamp: '2026-04-04T09:15:00Z' },
    { playerName: 'Beata', year: 2026, month: 4, selectedDates: ['2026-04-05', '2026-04-12', '2026-04-26'], timestamp: '2026-04-03T18:00:00Z' },
  ];
  localStorage.setItem('mexicano_changelog', JSON.stringify(changelog));

  console.log('[Seed] Loaded demo data with 12 members and 3 tournaments');
}
