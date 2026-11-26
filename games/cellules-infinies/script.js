class Cell {
    constructor(x, y, radius = 10, color = null) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.targetRadius = radius;
        this.color = color || this.generateRandomColor();
        this.age = 0;
        this.maxAge = Math.random() * 1000 + 500;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.energy = 100;
        this.generation = 1;
        this.pulsePhase = Math.random() * Math.PI * 2;
        this.isDividing = false;
        this.divisionCooldown = 0;
    }

    generateRandomColor() {
        const hue = Math.random() * 360;
        const saturation = 70 + Math.random() * 30;
        const lightness = 50 + Math.random() * 30;
        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }

    update(deltaTime) {
        this.age += deltaTime;
        this.pulsePhase += deltaTime * 0.003;
        
        // Mouvement organique
        this.x += this.vx;
        this.y += this.vy;
        
        // Friction
        this.vx *= 0.99;
        this.vy *= 0.99;
        
        // Pulsation naturelle
        const pulse = Math.sin(this.pulsePhase) * 0.1;
        this.radius = this.targetRadius + pulse;
        
        // Diminution du cooldown de division
        if (this.divisionCooldown > 0) {
            this.divisionCooldown -= deltaTime;
        }
        
        // Évolution de la couleur avec l'âge
        if (this.age > this.maxAge * 0.7) {
            this.evolveColor();
        }
    }

    evolveColor() {
        // Changement graduel de couleur avec l'âge
        const ageRatio = this.age / this.maxAge;
        const hue = (parseFloat(this.color.match(/\d+/)[0]) + ageRatio * 60) % 360;
        const saturation = 70 + Math.sin(ageRatio * Math.PI) * 20;
        const lightness = 50 + Math.cos(ageRatio * Math.PI) * 20;
        this.color = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }

    canDivide() {
        return this.energy > 80 && this.divisionCooldown <= 0 && this.radius > 8;
    }

    divide() {
        if (!this.canDivide()) return [];
        
        this.isDividing = true;
        this.energy -= 50;
        this.divisionCooldown = 2000; // 2 secondes
        
        const newCells = [];
        const numNewCells = Math.floor(Math.random() * 3) + 2; // 2-4 nouvelles cellules
        
        for (let i = 0; i < numNewCells; i++) {
            const angle = (Math.PI * 2 * i) / numNewCells;
            const distance = this.radius + 15;
            const newX = this.x + Math.cos(angle) * distance;
            const newY = this.y + Math.sin(angle) * distance;
            const newRadius = this.radius * 0.6 + Math.random() * 5;
            
            const newCell = new Cell(newX, newY, newRadius, this.color);
            newCell.generation = this.generation + 1;
            newCell.vx = Math.cos(angle) * 2;
            newCell.vy = Math.sin(angle) * 2;
            newCells.push(newCell);
        }
        
        // Réduire la taille de la cellule mère
        this.targetRadius *= 0.8;
        this.generation++;
        
        return newCells;
    }

    draw(ctx) {
        // Ombre
        ctx.save();
        ctx.shadowColor = this.color;
        ctx.shadowBlur = this.radius * 0.5;
        
        // Corps principal
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        
        // Effet de brillance
        const gradient = ctx.createRadialGradient(
            this.x - this.radius * 0.3, 
            this.y - this.radius * 0.3, 
            0,
            this.x, 
            this.y, 
            this.radius
        );
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Contour si en division
        if (this.isDividing) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        
        ctx.restore();
    }

    isClicked(mouseX, mouseY) {
        const distance = Math.sqrt((mouseX - this.x) ** 2 + (mouseY - this.y) ** 2);
        return distance <= this.radius;
    }
}

class InfiniteCellGame {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.cells = [];
        this.lastTime = 0;
        this.isPaused = false;
        this.generation = 1;
        this.cameraX = 0;
        this.cameraY = 0;
        this.targetCameraX = 0;
        this.targetCameraY = 0;
        
        this.setupCanvas();
        this.setupEventListeners();
        this.initializeCells();
        this.gameLoop();
    }

    setupCanvas() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    setupEventListeners() {
        // Clic de souris
        this.canvas.addEventListener('click', (e) => this.handleClick(e));
        
        // Mouvement de souris pour la caméra
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        
        // Contrôles
        document.getElementById('resetBtn').addEventListener('click', () => this.reset());
        document.getElementById('pauseBtn').addEventListener('click', () => this.togglePause());
        
        // Contrôles clavier
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
    }

    handleClick(e) {
        if (this.isPaused) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left + this.cameraX;
        const mouseY = e.clientY - rect.top + this.cameraY;
        
        let cellClicked = false;
        
        // Vérifier si une cellule a été cliquée
        for (let cell of this.cells) {
            if (cell.isClicked(mouseX, mouseY)) {
                const newCells = cell.divide();
                this.cells.push(...newCells);
                cellClicked = true;
                
                // Effet sonore (simulation visuelle)
                this.createClickEffect(mouseX, mouseY);
                break;
            }
        }
        
        // Si aucune cellule n'a été cliquée, créer une nouvelle cellule
        if (!cellClicked) {
            const newCell = new Cell(mouseX, mouseY, 15 + Math.random() * 10);
            this.cells.push(newCell);
            this.createClickEffect(mouseX, mouseY);
        }
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Mouvement subtil de la caméra basé sur la position de la souris
        this.targetCameraX = (mouseX - this.canvas.width / 2) * 0.1;
        this.targetCameraY = (mouseY - this.canvas.height / 2) * 0.1;
    }

    handleKeyDown(e) {
        switch(e.key) {
            case ' ':
                e.preventDefault();
                this.togglePause();
                break;
            case 'r':
                this.reset();
                break;
        }
    }

    createClickEffect(x, y) {
        // Créer des particules d'effet
        for (let i = 0; i < 5; i++) {
            const particle = new Cell(
                x + (Math.random() - 0.5) * 20,
                y + (Math.random() - 0.5) * 20,
                2 + Math.random() * 3
            );
            particle.vx = (Math.random() - 0.5) * 5;
            particle.vy = (Math.random() - 0.5) * 5;
            particle.maxAge = 200;
            this.cells.push(particle);
        }
    }

    initializeCells() {
        // Créer quelques cellules initiales
        for (let i = 0; i < 5; i++) {
            const x = Math.random() * this.canvas.width;
            const y = Math.random() * this.canvas.height;
            const cell = new Cell(x, y, 10 + Math.random() * 15);
            this.cells.push(cell);
        }
    }

    update(deltaTime) {
        if (this.isPaused) return;
        
        // Mettre à jour la caméra
        this.cameraX += (this.targetCameraX - this.cameraX) * 0.05;
        this.cameraY += (this.targetCameraY - this.cameraY) * 0.05;
        
        // Mettre à jour les cellules
        for (let i = this.cells.length - 1; i >= 0; i--) {
            const cell = this.cells[i];
            cell.update(deltaTime);
            
            // Supprimer les cellules trop vieilles ou trop petites
            if (cell.age > cell.maxAge || cell.radius < 1) {
                this.cells.splice(i, 1);
                continue;
            }
            
            // Division automatique occasionnelle
            if (Math.random() < 0.0001 && cell.canDivide()) {
                const newCells = cell.divide();
                this.cells.push(...newCells);
            }
        }
        
        // Générer de nouvelles cellules si il y en a trop peu
        if (this.cells.length < 3) {
            const x = Math.random() * this.canvas.width + this.cameraX;
            const y = Math.random() * this.canvas.height + this.cameraY;
            const cell = new Cell(x, y, 10 + Math.random() * 10);
            this.cells.push(cell);
        }
        
        // Mettre à jour les statistiques
        this.updateUI();
    }

    draw() {
        // Effacer le canvas avec un effet de traînée
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Sauvegarder le contexte pour la transformation de caméra
        this.ctx.save();
        this.ctx.translate(-this.cameraX, -this.cameraY);
        
        // Dessiner toutes les cellules
        for (let cell of this.cells) {
            cell.draw(this.ctx);
        }
        
        // Restaurer le contexte
        this.ctx.restore();
        
        // Dessiner les effets de particules en arrière-plan
        this.drawBackground();
    }

    drawBackground() {
        // Effet d'étoiles en arrière-plan
        this.ctx.save();
        this.ctx.globalAlpha = 0.3;
        for (let i = 0; i < 50; i++) {
            const x = (i * 137.5) % this.canvas.width;
            const y = (i * 73.7) % this.canvas.height;
            const size = Math.sin(this.lastTime * 0.001 + i) * 2 + 2;
            
            this.ctx.beginPath();
            this.ctx.arc(x, y, size, 0, Math.PI * 2);
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            this.ctx.fill();
        }
        this.ctx.restore();
    }

    updateUI() {
        document.getElementById('cellCount').textContent = `Cellules: ${this.cells.length}`;
        
        const maxGeneration = Math.max(...this.cells.map(cell => cell.generation), 1);
        document.getElementById('generation').textContent = `Génération: ${maxGeneration}`;
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        document.getElementById('pauseBtn').textContent = this.isPaused ? 'Reprendre' : 'Pause';
    }

    reset() {
        this.cells = [];
        this.generation = 1;
        this.cameraX = 0;
        this.cameraY = 0;
        this.targetCameraX = 0;
        this.targetCameraY = 0;
        this.initializeCells();
    }

    gameLoop(currentTime = 0) {
        const deltaTime = currentTime - this.lastTime;
        this.lastTime = currentTime;
        
        this.update(deltaTime);
        this.draw();
        
        requestAnimationFrame((time) => this.gameLoop(time));
    }
}

// Initialiser le jeu quand la page est chargée
document.addEventListener('DOMContentLoaded', () => {
    new InfiniteCellGame();
});

