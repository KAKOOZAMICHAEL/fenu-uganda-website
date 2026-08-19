const fs = require('fs');
const path = require('path');

const files = [
    'about.html', 'contact.html', 'gallery.html', 'partners.html', 
    'publications.html', 'thematic.html', 'work.html'
];

files.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) {
        console.log(`Skipping ${file} - not found`);
        return;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Remove from navigation
    content = content.replace(/<a href="projects\.html" class="nav-item nav-link(?:\s+active)?"><b>Projects<\/b><\/a>\s*/g, '');
    
    // Remove from footer
    content = content.replace(/<a class="btn btn-link" href="projects\.html">Projects<\/a>\s*/g, '');
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${file}`);
});

console.log('All files updated successfully');
