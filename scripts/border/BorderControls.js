import { BorderGenerator } from './BorderGenerator.js';

const MODULE_ID = 'ionrift-waterline';

/**
 * UI controls for the border generator.
 * Dialog stays open for repeated generation until the user is happy.
 */
export class BorderControls {

    /**
     * Opens the border configuration dialog with remembered values.
     */
    static showDialog() {
        if (!game.user.isGM) return;

        const saved = game.settings.get(MODULE_ID, 'borderConfig') ?? {};
        const cfg = {
            totalVertices: saved.totalVertices ?? 29,
            amplitude:     saved.amplitude ?? 244,
            jitter:        saved.jitter ?? 0.5,
            inset:         saved.inset ?? 7
        };

        const d = new Dialog({
            title: 'Waterline: Borders',
            content: `
                <form class="water-config-form border-config-form">
                    <div class="water-config-body">
                        <div class="wc-section">
                            <h3><i class="fas fa-border-all"></i> Border Walls</h3>
                            <div class="form-group">
                                <label title="Number of wall segments around the perimeter">Vertices</label>
                                <input type="range" name="totalVertices" min="16" max="80" value="${cfg.totalVertices}" />
                                <span class="range-value">${cfg.totalVertices}</span>
                            </div>
                            <div class="form-group">
                                <label title="How far walls deviate inward from the edge">Amplitude</label>
                                <input type="range" name="amplitude" min="20" max="400" value="${cfg.amplitude}" />
                                <span class="range-value">${cfg.amplitude}</span>
                            </div>
                            <div class="form-group">
                                <label title="Randomness of vertex spacing">Jitter</label>
                                <input type="range" name="jitter" min="0" max="0.8" value="${cfg.jitter}" step="0.1" />
                                <span class="range-value">${cfg.jitter}</span>
                            </div>
                            <div class="form-group">
                                <label title="Pixel offset inward from the scene edge">Inset</label>
                                <input type="range" name="inset" min="0" max="100" value="${cfg.inset}" />
                                <span class="range-value">${cfg.inset}</span>
                            </div>
                        </div>

                        <div class="wc-footer-actions border-actions">
                            <button type="button" class="cartograph-btn cartograph-btn-organic" title="Generate organic border (re-rolls each click)">
                                <i class="fas fa-mountain"></i> Organic
                            </button>
                            <button type="button" class="cartograph-btn cartograph-btn-straight" title="Generate 4 straight walls">
                                <i class="fas fa-vector-square"></i> Straight
                            </button>
                            <button type="button" class="cartograph-btn border-btn-clear" title="Remove all border walls">
                                <i class="fas fa-trash-alt"></i> Clear
                            </button>
                        </div>
                        <p class="wc-layer-hint">
                            <i class="fas fa-info-circle"></i>
                            Click Organic repeatedly to re-roll. Adjust sliders between clicks.
                        </p>
                    </div>
                </form>
            `,
            buttons: {},
            render: (html) => {
                // Live slider value display
                html.find('input[type="range"]').on('input', (ev) => {
                    ev.target.nextElementSibling.textContent = ev.target.value;
                });

                // Organic button
                html.find('.cartograph-btn-organic').on('click', async () => {
                    const form = html[0].querySelector('form');
                    const config = {
                        totalVertices: Number(form.totalVertices.value),
                        amplitude:     Number(form.amplitude.value),
                        jitter:        Number(form.jitter.value),
                        inset:         Number(form.inset.value)
                    };
                    game.settings.set(MODULE_ID, 'borderConfig', config);
                    await BorderGenerator.createBorder(config);
                });

                // Straight button
                html.find('.cartograph-btn-straight').on('click', async () => {
                    const form = html[0].querySelector('form');
                    const inset = Number(form.inset.value);
                    await BorderGenerator.createStraightBorder(inset);
                });

                // Clear button
                html.find('.border-btn-clear').on('click', async () => {
                    await BorderGenerator.clearBorder();
                });
            }
        }, {
            width: 380,
            classes: ['ionrift-window', 'water-config-dialog']
        });

        d.render(true);
    }

    /**
     * Prompts before clearing border walls.
     */
    static confirmClear() {
        if (!game.user.isGM) return;

        Dialog.confirm({
            title: 'Waterline: Clear Borders',
            content: '<p>Remove all generated border walls from this scene?</p>',
            yes: () => BorderGenerator.clearBorder(),
            no: () => {},
            defaultYes: false
        });
    }
}
